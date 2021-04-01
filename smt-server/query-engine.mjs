// Stellarium Web - Copyright (c) 2020 - Stellarium Labs SAS
//
// This program is licensed under the terms of the GNU AGPL v3, or
// alternatively under a commercial licence.
//
// The terms of the AGPL v3 license can be found in the main directory of this
// repository.
//
// This file is part of the Survey Monitoring Tool plugin, which received
// funding from the Centre national d'études spatiales (CNES).

import Database from 'better-sqlite3'
import _ from 'lodash'
import filtrex from 'filtrex'
import turf from '@turf/turf'
import assert from 'assert'
import geo_utils from './geojson-utils.mjs'
import fs from 'fs'
import workerpool from 'workerpool'
import os from 'os'
import healpix from '@hscmap/healpix'

const HEALPIX_ORDER = 5
const HEALPIX_PIXEL_AREA = healpix.nside2pixarea(1 << HEALPIX_ORDER)
const AREA_TOLERANCE = 0.0001 / geo_utils.STERADIAN_TO_DEG2

const __dirname = process.cwd()

const fId2SqlId = function (fieldId) {
  return fieldId.replace(/\./g, '_')
}

const fType2SqlType = function (fieldType) {
  if (fieldType === 'string') return 'TEXT'
  if (fieldType === 'date') return 'INT' // Dates are converted to unix time stamp
  if (fieldType === 'number') return 'NUMERIC'
  if (fieldType === 'int') return 'INT'
  return 'JSON'
}

const postProcessSQLiteResult = function (res) {
  for (const i in res) {
    const item = res[i]
    if (typeof item === 'string' && item.startsWith('__JSON'))
      res[i] = JSON.parse(item.substring(6))
  }
}

export default class QueryEngine {
  // Private attributes
  #fieldsList = undefined
  #fieldsMap = undefined
  #db = undefined
  #dbFileName = undefined
  smtConfig = undefined

  // the thread pool used to run async functions
  static pool = undefined

  constructor(dbFileName) {
    let that = this
    assert(fs.existsSync(dbFileName))
    that.#dbFileName = dbFileName
    const db = new Database(dbFileName, { readonly: true });
    that.smtConfig = JSON.parse(db.prepare('SELECT smt_config from smt_meta_data').get().smt_config)
    that.extraInfo = JSON.parse(db.prepare('SELECT extra_info from smt_meta_data').get().extra_info)

    // Initialize modules's attributes based on the config file
    that.#fieldsList = _.cloneDeep(that.smtConfig.fields)
    that.#fieldsMap = {}
    for (let i in that.#fieldsList) {
      that.#fieldsMap[that.#fieldsList[i].id] = that.#fieldsList[i]
      if (that.#fieldsList[i].computed) {
        let options = {
          extraFunctions: { date2unix: function (dstr) { return new Date(dstr).getTime() } },
          customProp: (path, unused, obj) => _.get(obj, path, undefined)
        }
        that.#fieldsList[i].computed_compiled = filtrex.compileExpression(that.#fieldsList[i].computed, options)
      }
    }
    // Add dummy entries matching our generated fields
    that.#fieldsMap['id'] = { type: 'number' }
    that.#fieldsMap['healpix_index'] = { type: 'number' }
    that.#fieldsMap['geogroup_id'] = { type: 'string' }
    that.#fieldsMap['area'] = { type: 'number' }
    that.#fieldsMap['geocap_x'] = { type: 'number' }
    that.#fieldsMap['geocap_y'] = { type: 'number' }
    that.#fieldsMap['geocap_z'] = { type: 'number' }
    that.#fieldsMap['geocap_cosa'] = { type: 'number' }

    // Add a custom aggregation operator for the chip tags
    db.aggregate('VALUES_AND_COUNT', {
      start: undefined,
      step: (accumulator, value, limit) => {
        if (!accumulator) accumulator = {}
        if (value === null) value = '__undefined'
        const prevValue = accumulator[value]
        if (prevValue === undefined) {
          if (accumulator.__overflow) {
            accumulator.__overflow++
            return accumulator
          }
          accumulator[value] = 1
          if (Object.keys(accumulator).length >= limit) accumulator.__overflow = 1
        } else {
          accumulator[value]++
        }
        return accumulator
      },
      result: accumulator => accumulator ? '__JSON' + JSON.stringify(accumulator) : undefined
    })

    db.aggregate('MIN_MAX', {
      start: () => [null, null],
      step: (accumulator, value) => {
        if (value === null) return accumulator
        if (accumulator[0] === null) return [value, value]
        return [Math.min(accumulator[0], value), Math.max(accumulator[1], value)]
      },
      result: accumulator => accumulator && accumulator[0] !== null ? '__JSON' + JSON.stringify(accumulator) : undefined
    })

    // Compute the union of all passed JSON-serialized geometries guaranteed to
    // be contained in the given healpix pixel.
    // The function stops earlier if the area becomes larger than the full healpix pixel
    const multiUnionOnHealpix = function (maxArea, arr) {
      if (!arr) return { area: 0 }

      // Return quickly if one element is already larger than maxArea
      const fullElem = arr.find(e => e.area >= maxArea)
      if (fullElem) return fullElem

      // Remove elements with duplicated geometry
      let set = new Set()
      arr = arr.filter(e => { if (set.has(e.geometry)) return false; set.add(e.geometry); return true; })
      set = undefined

      if (arr.length === 1)
        return arr[0]

      // Now we need to compute union
      let union
      let farea = 0
      let lastErr
      let nbErr = 0

      for (const item of arr) {
        const f = { type: "Feature", geometry: JSON.parse(item.geometry.substring(6)) }
        if (union === undefined) {
          union = f
          farea = item.area
        } else {
          try {
            union = turf.union(union, f)
            turf.truncate(union, {precision: 6, coordinates: 2, mutate: true})
            farea = geo_utils.featureArea(union)
          } catch (err) {
            nbErr++
            lastErr = err
          }
        }
        // If we already reached the maximum size for this healpix pixel we
        // can already stop.
        if (farea >= maxArea) break
      }
      if (lastErr) {
        console.log('' + nbErr + ' errors while computing union, last one: ' + lastErr)
      }
      return { area: farea, geometry: '__JSON' + JSON.stringify(union.geometry) }
    }

    // Geo union for features guaranteed to be in the same healpix pixel
    db.aggregate('GEO_UNION_ON_HEALPIX', {
      start: undefined,
      step: function (accumulator, healpixIndex, geometry, area) {
        // console.assert(typeof geometry === 'string' && geometry.startsWith('__JSON'))
        // if (accumulator) console.assert(accumulator.healpixIndex === healpixIndex)
        if (!accumulator) {
          return {
            data: [{area: area, geometry: geometry}],
            healpixIndex: healpixIndex
          }
        }
        accumulator.data.push({area: area, geometry: geometry})
      },
      result: accumulator => {
        if (!accumulator)
          return undefined
        const maxArea = geo_utils.getHealpixTurfArea(HEALPIX_ORDER, accumulator.healpixIndex) - AREA_TOLERANCE
        return multiUnionOnHealpix(maxArea, accumulator.data).geometry
      }
    })

    db.aggregate('GEO_UNION_AREA_ON_HEALPIX', {
      start: undefined,
      step: function (accumulator, healpixIndex, geometry, area) {
        // console.assert(typeof geometry === 'string' && geometry.startsWith('__JSON'))
        //if (accumulator) console.assert(accumulator.healpixIndex === healpixIndex)
        if (!accumulator) {
          return {
            data: [{area: area, geometry: geometry}],
            healpixIndex: healpixIndex
          }
        }
        accumulator.data.push({area: area, geometry: geometry})
      },
      result: accumulator => {
        if (!accumulator)
          return undefined
        const maxArea = geo_utils.getHealpixTurfArea(HEALPIX_ORDER, accumulator.healpixIndex) - AREA_TOLERANCE
        return multiUnionOnHealpix(maxArea, accumulator.data).area
      }
    })

    db.aggregate('GEO_UNION_AREA_ON_HEALPIX_CUMULATED_HISTOGRAM', {
      start: undefined,
      step: function (accumulator, healpixIndex, geometry, area, bin) {
        //console.assert(typeof geometry === 'string' && geometry.startsWith('__JSON'))
        //if (accumulator) console.assert(accumulator.healpixIndex === healpixIndex)
        if (!accumulator) {
          const acc = {
            bins: {},
            healpixIndex: healpixIndex
          }
          acc.bins[bin] = [{area: area, geometry: geometry}]
          return acc
        }
        if (bin in accumulator.bins) accumulator.bins[bin].push({area: area, geometry: geometry})
        else accumulator.bins[bin] = [{area: area, geometry: geometry}]
      },
      result: accumulator => {
        if (!accumulator)
          return undefined

        // Split by bin
        const bins = accumulator.bins
        const sortedKeys = Object.keys(bins).sort((a, b) => {
          if (a === b) return 0
          if (a === 'null') return -1
          if (b === 'null') return 1
          return (a > b) - (a < b)
        })

        const maxArea = geo_utils.getHealpixTurfArea(HEALPIX_ORDER, accumulator.healpixIndex) - AREA_TOLERANCE
        let lastRes
        let res = {}
        for (const k of sortedKeys) {
          const arr = bins[k]
          lastRes = multiUnionOnHealpix(maxArea, lastRes ? [lastRes].concat(arr) : arr)
          res[k] = lastRes.area
          if (lastRes.area >= maxArea) break
        }
        return '__JSON' + JSON.stringify(res)
      }
    })

    // Get a bounding cap which contains all features
    db.aggregate('GEO_BOUNDING_CAP', {
      start: undefined,
      step: function (accumulator, geocap_x, geocap_y, geocap_z, geocap_cosa) {
        if (!accumulator) {
          return [geocap_x, geocap_y, geocap_z, geocap_cosa]
        }
        accumulator = geo_utils.mergeCaps(accumulator, [geocap_x, geocap_y, geocap_z, geocap_cosa])
        return accumulator
      },
      result: accumulator => {
        if (!accumulator)
          return undefined
        return '__JSON' + JSON.stringify(accumulator)
      }
    })

    that.#db = db
  }

  queryAsync (...parameters) {
    return QueryEngine.pool.exec('query', [this.#dbFileName].concat(parameters))
  }

  getHipsTileAsync (...parameters) {
    return QueryEngine.pool.exec('getHipsTile', [this.#dbFileName].concat(parameters))
  }

  // Construct the SQL WHERE clause matching the given constraints
  constraints2SQLWhereClause (constraints) {
    let that = this
    if (!constraints || constraints.length === 0) {
      return ''
    }
    // Group constraints by field. We do a OR between constraints for the same field, AND otherwise.
    let groupedConstraints = {}
    for (let i in constraints) {
      let c = constraints[i]
      if (c.fieldId in groupedConstraints) {
        groupedConstraints[c.fieldId].push(c)
      } else {
        groupedConstraints[c.fieldId] = [c]
      }
    }
    groupedConstraints = Object.values(groupedConstraints)

    // Convert one contraint to a SQL string
    let c2sql = function (c) {
      const fid = fId2SqlId(c.fieldId)
      if (c.operation === 'STRING_EQUAL') {
        return fid + ' = \'' + c.expression + '\''
      } else if (c.operation === 'INT_EQUAL') {
        return fid + ' = ' + c.expression
      } else if (c.operation === 'IS_UNDEFINED') {
        return fid + ' IS NULL'
      } else if (c.operation === 'DATE_RANGE') {
        return '( ' + fid + ' IS NOT NULL AND ' + fid + ' >= ' + c.expression[0] +
          ' AND ' + fid + ' <= ' + c.expression[1] + ')'
      } else if (c.operation === 'NUMBER_RANGE') {
        return '( ' + fid + ' IS NOT NULL AND ' + fid + ' >= ' + c.expression[0] +
          ' AND ' + fid + ' <= ' + c.expression[1] + ')'
      } else if (c.operation === 'IN') {
        let fType = that.#fieldsMap[c.fieldId] ? that.#fieldsMap[c.fieldId].type : undefined
        if (fType === 'string') {
          return '( ' + fid + ' IN (' + c.expression.map(e => "'" + e + "'").join(', ') + ') )'
        } else {
          return '( ' + fid + ' IN (' + c.expression.map(e => '' + e).join(', ') + ') )'
        }
      } else {
        throw new Error('Unsupported query operation: ' + c.operation)
      }
    }

    let whereClause = ' WHERE '
    for (let i in groupedConstraints) {
      let gCons = groupedConstraints[i]
      if (gCons.length > 1) whereClause += ' ('
      for (let j in gCons) {
        whereClause += c2sql(gCons[j])
        if (j < gCons.length - 1) {
          whereClause += ' OR '
        }
      }
      if (gCons.length > 1) whereClause += ') '
      if (i < groupedConstraints.length - 1) {
        whereClause += ' AND '
      }
    }
    return whereClause
  }

  // Construct the SQL GROUP BY clause matching the given groupingOptions
  groupingOptions2SQLGroupByClause (groupingOptions) {
    if (!groupingOptions || groupingOptions.length === 0) {
      return ''
    }
    console.assert(groupingOptions.length === 1)
    if (groupingOptions[0].operation === 'GROUP_ALL') {
      return ''
    } else if (groupingOptions[0].operation === 'GROUP_BY') {
      return 'GROUP BY ' + groupingOptions[0].fieldId
    } else if (groupingOptions[0].operation === 'GROUP_BY_DATE') {
      const fid = fId2SqlId(groupingOptions[0].fieldId)
      if (!groupingOptions[0].step) {
        throw new Error('GROUP_BY_DATE grouping operation require a step parameter')
      }
      const step = {
        'year': '%Y',
        'month': '%Y-%m',
        'day': '%Y-%m-%d'
      }[groupingOptions[0].step]
      return 'GROUP BY STRFTIME(\'' + step + '\', ROUND(' + fid + '/1000), \'unixepoch\')'
    } else {
      throw new Error('Unsupported grouping operation: ' + groupingOptions[0].operation)
    }
    return ''
  }

  getDateMinMaxStep (q, fieldId, minSteps) {
    let whereClause = this.constraints2SQLWhereClause(q.constraints)
    const fid = fId2SqlId(fieldId)
    const wc = (whereClause === '') ? ' WHERE ' + fid + ' IS NOT NULL' : whereClause + ' AND ' + fid + ' IS NOT NULL'
    const req = 'SELECT MIN(' + fid + ') AS dmin, MAX(' + fid + ') AS dmax FROM features ' + wc
    const res = this.#db.prepare(req).get()
    postProcessSQLiteResult(res)
    let start = new Date(res.dmin)
    start.setUTCHours(0, 0, 0, 0)
    // Switch to next day and truncate
    let stop = new Date(res.dmax + 1000 * 60 * 60 * 24)
    stop.setUTCHours(23, 59, 59, 0)
    // Range in days
    let range = (stop - start) / (1000 * 60 * 60 * 24)
    let step = '%Y-%m-%d'
    if (range > minSteps * 365) {
      step = '%Y'
    } else if (range > minSteps * 30) {
      step = '%Y-%m'
    }

    // Adjust min max so that they fall on an integer number of month/year
    if (step === '%Y-%m-%d') {
      // Min max already OK
    } else if (step === '%Y-%m') {
      start.setUTCDate(1)
      stop.setUTCMonth(stop.getUTCMonth() + 1, 0)
    } else if (step === '%Y') {
      start.setUTCDate(1)
      start.setUTCMonth(0)
      stop.setUTCFullYear(stop.getUTCFullYear(), 11, 31)
    }
    if (res.dmin === res.dmax) stop = start

    return {
      min: start,
      max: stop,
      step: step
    }
  }

  getNumberMinMaxStep (q, fieldId, nbCol) {
    let whereClause = this.constraints2SQLWhereClause(q.constraints)
    const fid = fId2SqlId(fieldId)
    const wc = (whereClause === '') ? ' WHERE ' + fid + ' IS NOT NULL' : whereClause + ' AND ' + fid + ' IS NOT NULL'
    const req = 'SELECT MIN(' + fid + ') AS dmin, MAX(' + fid + ') AS dmax FROM features ' + wc
    const res = this.#db.prepare(req).get()
    postProcessSQLiteResult(res)
    let step = 1
    if (res.dmin === res.dmax) {
      if (res.dmin === null) res.dmin = undefined
      if (res.dmax === null) res.dmax = undefined
    } else {
      step = (res.dmax - res.dmin) / nbCol
    }

    return {
      min: res.dmin,
      max: res.dmax,
      step: step
    }
  }

  // Query the engine
  query (q) {
    let that = this
    let whereClause = this.constraints2SQLWhereClause(q.constraints)

    if (q.limit && Number.isInteger(q.limit)) {
      whereClause += ' LIMIT ' + q.limit
    }
    if (q.skip && Number.isInteger(q.skip)) {
      whereClause += ' FETCH ' + q.skip
    }

    // Construct the SQL SELECT clause matching the given aggregate options
    let selectClause = []
    if (q.projectOptions) {
      selectClause = Object.keys(q.projectOptions).map(k => fId2SqlId(k))
    }

    let fromClause = ' FROM features'

    if (q.aggregationOptions) {
      assert(!q.projectOptions)

      whereClause += ' ' + this.groupingOptions2SQLGroupByClause(q.groupingOptions)

      for (let i in q.aggregationOptions) {
        const agOpt = q.aggregationOptions[i]
        console.assert(agOpt.out)
        if (agOpt.operation === 'COUNT') {
          selectClause.push('COUNT(*) as ' + agOpt.out)
        } else if (agOpt.operation === 'MIN') {
          selectClause.push('MIN(' + fId2SqlId(agOpt.fieldId) + ') as ' + agOpt.out)
        } else if (agOpt.operation === 'MAX') {
          selectClause.push('MAX(' + fId2SqlId(agOpt.fieldId) + ') as ' + agOpt.out)
        } else if (agOpt.operation === 'VALUES_AND_COUNT') {
          const limit = agOpt.limit || 20
          selectClause.push('VALUES_AND_COUNT(' + fId2SqlId(agOpt.fieldId) + ', ' + limit + ') as ' + agOpt.out)
        } else if (agOpt.operation === 'MIN_MAX') {
          selectClause.push('MIN_MAX(' + fId2SqlId(agOpt.fieldId) + ') as ' + agOpt.out)
        } else if (agOpt.operation === 'GEO_UNION_AREA') {
          agOpt.postProcessData = that.computeArea(q)
        } else if (agOpt.operation === 'GEO_UNION_AREA_CUMULATED_DATE_HISTOGRAM') {
          console.assert(q.groupingOptions && q.groupingOptions.length === 1 && q.groupingOptions[0].operation === 'GROUP_ALL')
          agOpt.postProcessData = that.computeAreaCumulatedDateHistogram(q, agOpt)
        } else if (agOpt.operation === 'GEO_BOUNDING_CAP') {
          selectClause.push('GEO_BOUNDING_CAP(geocap_x, geocap_y, geocap_z, geocap_cosa) as ' + agOpt.out)
        } else if (agOpt.operation === 'DATE_HISTOGRAM') {
          const res = that.getDateMinMaxStep(q, agOpt.fieldId, 3)
          const fid = fId2SqlId(agOpt.fieldId)
          selectClause.push('VALUES_AND_COUNT(' + 'STRFTIME(\'' + res.step + '\', ROUND(' + fid + '/1000), \'unixepoch\')' + ', 200) AS ' + agOpt.out)
          res.table = [['Date', 'Count']]
          agOpt.postProcessData = res
        } else if (agOpt.operation === 'NUMBER_HISTOGRAM') {
          const fid = fId2SqlId(agOpt.fieldId)
          const res= that.getNumberMinMaxStep(q, agOpt.fieldId, 10)
          const qmin = res.min !== undefined ? res.min : 0
          selectClause.push('VALUES_AND_COUNT(' + 'ROUND((' + fid + ' - ' + qmin + ') / ' + res.step + ') * ' + res.step + ' + ' + qmin + ', 200) AS ' + agOpt.out)
          res.noval = 0
          res.table = [['Value', 'Count']]
          agOpt.postProcessData = res
        } else {
          throw new Error('Unsupported aggregation operation: ' + agOpt.operation)
        }
      }
    }

    const postProcessAggResultLine = function (line) {

      for (let i in q.aggregationOptions) {
        const agOpt = q.aggregationOptions[i]
        if (agOpt.operation === 'GEO_UNION_AREA' || agOpt.operation === 'GEO_UNION_AREA_CUMULATED_DATE_HISTOGRAM') {
          line[agOpt.out] = agOpt.postProcessData
        } else if (agOpt.operation === 'DATE_HISTOGRAM') {
          const start = agOpt.postProcessData.min
          const stop = agOpt.postProcessData.max
          const step = agOpt.postProcessData.step
          let tmpTable = {}
          // Prefill the table to make sure that all steps do have a value
          let d = new Date(start.getTime())
          if (step === '%Y') {
            for (; d < stop; d.setUTCFullYear(d.getUTCFullYear() + 1)) {
              tmpTable[d.toISOString().slice(0, 4)] = 0
            }
          } else if (step === '%Y-%m') {
            for (; d < stop; d.setUTCMonth(d.getUTCMonth() + 1)) {
              tmpTable[d.toISOString().slice(0, 7)] = 0
            }
          } else if (step === '%Y-%m-%d') {
            for (; d < stop; d.setUTCDate(d.getUTCDate() + 1)) {
              tmpTable[d.toISOString().slice(0, 10)] = 0
            }
          }
          let data = _.cloneDeep(agOpt.postProcessData)
          let r = line[agOpt.out]
          for (let j in r) {
            if (j === '__undefined')
              data.noval = r[j]
            else
              tmpTable[j] = r[j]
          }
          Object.keys(tmpTable).forEach(function (key) {
            data.table.push([key, tmpTable[key]])
          })
          line[agOpt.out] = data
        } else if (agOpt.operation === 'NUMBER_HISTOGRAM') {
          const start = agOpt.postProcessData.min
          const stop = agOpt.postProcessData.max
          const step = agOpt.postProcessData.step
          let tmpTable = {}
          // Prefill the table to make sure that all steps do have a value
          for (let d = start; d < stop; d += step) {
            tmpTable['' + d] = 0
          }
          let data = _.cloneDeep(agOpt.postProcessData)
          let r = line[agOpt.out]
          for (let j in r) {
            if (j === '__undefined')
              data.noval = r[j]
            else
              tmpTable[j] = r[j]
          }
          Object.keys(tmpTable).forEach(function (key) {
            data.table.push([key, tmpTable[key]])
          })
          data.table.sort(function (a, b) {
            if (a[0] === 'Value') return -1
            return parseFloat(a[0]) - parseFloat(b[0])
          })
          line[agOpt.out] = data
        }
        agOpt.postProcessData = undefined
      }
    }

    let res = [{}]
    if (selectClause.length) {
      const sqlStatement = 'SELECT ' + selectClause.join(', ') + ' ' + fromClause + whereClause
      res = that.#db.prepare(sqlStatement).all()
    }
    for (let i in res) {
      // Post-process each resulting line
      postProcessSQLiteResult(res[i])
      if (q.aggregationOptions) postProcessAggResultLine(res[i])
    }
    return { q: q, res: res }
  }

  getHipsProperties () {
    return `hips_tile_format = geojson\nhips_order = 2\nhips_order_min = 1` +
        '\nhips_tile_width = 400\nobs_title = SMT Geojson'
  }

  getHipsTile (q, order, tileId) {
    const that = this
    // Can be 0: lowest details, only plain healpix tiles shapes
    //        1: medium details, the union of all footprints per tile
    //        2: high details, the union of all footprints having the same geo_groupid
    let LOD_LEVEL = 2

    if (order === -1) {
      // Special case for Allsky
      tileId = -1
    } else if (order === 1) {
      LOD_LEVEL = 0
    }

    const healPixScale = (tileId === -1) ? 1 : Math.pow(4, HEALPIX_ORDER - order)
    const queryTileId = tileId * healPixScale
    q.constraints.push({
      fieldId: 'healpix_index',
      operation: 'NUMBER_RANGE',
      expression: [queryTileId, queryTileId + healPixScale - 1],
      negate: false
    })
    const whereClause = this.constraints2SQLWhereClause(q.constraints)

    // Construct the SQL SELECT clause matching the given aggregate options
    let selectClause = 'SELECT '
    selectClause += this.#fieldsList.filter(f => f.widget !== 'tags').map(f => fId2SqlId(f.id)).map(k => 'MIN_MAX(' + k + ') as ' + k).join(', ')
    selectClause += ', ' + this.#fieldsList.filter(f => f.widget === 'tags').map(f => fId2SqlId(f.id)).map(k => 'VALUES_AND_COUNT(' + k + ', 10) as ' + k).join(', ')
    selectClause += ', COUNT(*) as c, healpix_index ' + (LOD_LEVEL === 0 ? '' : ', geogroup_id, geometry ') + 'FROM subfeatures '
    let sqlStatement = selectClause + whereClause
    if (tileId !== -1) {
      let extraGroupBy = ''
      if (q.groupingOptions && q.groupingOptions.length === 1 && q.groupingOptions[0].operation === 'GROUP_BY')
        extraGroupBy = ', ' + q.groupingOptions[0].fieldId
      sqlStatement += ' GROUP BY ' + (LOD_LEVEL > 1 ? 'healpix_index, geogroup_id' : 'healpix_index') + extraGroupBy
    } else {
      sqlStatement += ' GROUP BY id'
    }
    const stmt = that.#db.prepare(sqlStatement)
    let res = stmt.all()
    res = res.filter(f => f.c)
    const geojson = {
      type: 'FeatureCollection',
      features: []
    }
    for (const item of res) {
      postProcessSQLiteResult(item)
      const feature = {
        geometry: LOD_LEVEL === 0 ? geo_utils.getHealpixCornerFeature(HEALPIX_ORDER, item.healpix_index).geometry : item.geometry,
        type: 'Feature',
        properties: item,
        geogroup_id: item.geogroup_id,
        healpix_index: item.healpix_index,
        geogroup_size: item.c
      }
      delete feature.properties.geometry
      delete feature.properties.geogroup_id
      delete feature.properties.healpix_index
      delete feature.properties.c
      geojson.features.push(feature)
    }
    return geojson.features.length ? geojson : undefined
  }

  computeArea (q) {
    let whereClause = this.constraints2SQLWhereClause(q.constraints)
    let sqlStatement = 'SELECT SUM(area) as area FROM (SELECT GEO_UNION_AREA_ON_HEALPIX(healpix_index, geometry_rot, area) as area FROM subfeatures ' + whereClause + ' GROUP BY healpix_index)'
    let res = this.#db.prepare(sqlStatement).get()
    return res.area
  }

  computeAreaCumulatedDateHistogram (q, agOpt) {
    if (!agOpt.dateFieldId) {
      throw new Error('GEO_UNION_AREA_CUMULATED_DATE_HISTOGRAM require a dateFieldId parameter')
    }
    if (!agOpt.step) {
      throw new Error('GEO_UNION_AREA_CUMULATED_DATE_HISTOGRAM require a step parameter')
    }
    let whereClause = this.constraints2SQLWhereClause(q.constraints)
    const dateFid = fId2SqlId(agOpt.dateFieldId)
    const step = {
      'year': '%Y',
      'month': '%Y-%m',
      'day': '%Y-%m-%d'
    }[agOpt.step]
    const binFunc = 'STRFTIME(\'' + step + '\', ROUND(' + dateFid + '/1000), \'unixepoch\')'
    let sqlStatement = 'SELECT GEO_UNION_AREA_ON_HEALPIX_CUMULATED_HISTOGRAM(healpix_index, geometry_rot, area, ' + binFunc + ') as areaHisto FROM subfeatures ' + whereClause + ' GROUP BY healpix_index'
    let res = this.#db.prepare(sqlStatement).all()
    // Combine the cumulated histograms of all healpix pixels
    res = res.map(line => JSON.parse(line.areaHisto.substring(6)))
    let allKeys = new Set()
    res.forEach(line => Object.keys(line).forEach(k => allKeys.add(k)))
    allKeys = Array.from(allKeys)
    allKeys.sort((a, b) => {
      if (a === b) return 0
      if (a === 'null') return -1
      if (b === 'null') return 1
      return (a > b) - (a < b)
    })
    const histo = {}
    for (const k of allKeys) {
      histo[k] = 0
    }
    for (const line of res) {
      let lastArea = 0
      for (const k of allKeys) {
        if (k in line) lastArea = line[k]
        histo[k] += lastArea
      }
    }
    return histo
  }

  static getDbExtraInfo (dbFileName) {
    if (!fs.existsSync(dbFileName)) return undefined
    const db = new Database(dbFileName, { readonly: true });
    return JSON.parse(db.prepare('SELECT extra_info from smt_meta_data').get().extra_info)
  }

  static generateDb (dataDir, dbFileName, extraInfo) {
    // Create the DB file and ingest all data present in dataDir + user-passed
    // extraInfo data.
    const dbAlreadyExists = fs.existsSync(dbFileName)
    if (dbAlreadyExists) {
      // supress previous DB
      console.log('Suppress existing DB at: ' + dbFileName)
      fs.unlinkSync(dbFileName)
    }
    console.log('Create new Data Base: ' + dbFileName)
    const db = new Database(dbFileName)
    const smtConfig = JSON.parse(fs.readFileSync(dataDir + '/smtConfig.json'))

    // Initialize modules's attributes based on the config file
    const fieldsList = _.cloneDeep(smtConfig.fields)
    const sqlFields = fieldsList.map(f => fId2SqlId(f.id))

    // Initialize DB structure

    // Save config file and extra info inside the DB
    db.prepare('CREATE TABLE smt_meta_data (smt_config TEXT, extra_info TEXT)').run()
    db.prepare('INSERT INTO smt_meta_data (smt_config, extra_info) VALUES (?, ?)').run(JSON.stringify(smtConfig), JSON.stringify(extraInfo))

    const sqlFieldsAndTypes = fieldsList.map(f => fId2SqlId(f.id) + ' ' + fType2SqlType(f.type)).join(', ')
    db.prepare('CREATE TABLE features (geometry TEXT, geogroup_id TEXT, area REAL, geocap_x REAL, geocap_y REAL, geocap_z REAL, geocap_cosa REAL, properties TEXT, ' + sqlFieldsAndTypes + ')').run()
    db.prepare('CREATE INDEX idx_geogroup_id ON features(geogroup_id)').run()

    db.prepare('CREATE TABLE subfeatures (id INT, geometry TEXT, geometry_rot TEXT, healpix_index INT, geogroup_id TEXT, area REAL, ' + sqlFieldsAndTypes + ')').run()
    db.prepare('CREATE INDEX idxsub_id ON subfeatures(id)').run()
    db.prepare('CREATE INDEX idxsub_geogroup_id ON subfeatures(geogroup_id)').run()
    db.prepare('CREATE INDEX idxsub_healpix_index ON subfeatures(healpix_index)').run()

    // Create an index on each field
    for (let i in sqlFields) {
      const field = sqlFields[i]
      db.prepare('CREATE INDEX idx_' + i + ' ON features(' + field + ')').run()
      db.prepare('CREATE INDEX idxsub_' + i + ' ON subfeatures(' + field + ')').run()
    }
    db.pragma('journal_mode = WAL')
    db.close()

    // Ingest all geojson files listed in the smtConfig
    const pool = workerpool.pool('./worker.mjs')
    const allPromise = smtConfig.sources.map(url => pool.exec('ingestGeoJson', [dbFileName, dataDir + '/' + url]))
    return Promise.all(allPromise).then(() => pool.terminate())
  }

  // Ingest geojson file fileName into the database at dbFileName
  static ingestGeoJson (dbFileName, fileName) {
    const jsonData = JSON.parse(fs.readFileSync(fileName))
    const db = new Database(dbFileName, { fileMustExist: true, timeout: 3600000 }) // 1h timeout

    const smtConfig = JSON.parse(db.prepare('SELECT smt_config from smt_meta_data').get().smt_config)
    const fieldsList = _.cloneDeep(smtConfig.fields)
    const sqlFields = fieldsList.map(f => fId2SqlId(f.id))

    // Compile filtrex expressions used for creating generated fields
    for (let i in fieldsList) {
      if (fieldsList[i].computed) {
        const options = {
          extraFunctions: { date2unix: function (dstr) { return new Date(dstr).getTime() } },
          customProp: (path, unused, obj) => _.get(obj, path, undefined)
        }
        fieldsList[i].computed_compiled = filtrex.compileExpression(fieldsList[i].computed, options)
      }
    }

    const quickTestMode = process.env.SMT_QUICK_TEST
    if (quickTestMode) {
      jsonData.features = jsonData.features.slice(0, 100)
    }
    console.log('Loading ' + jsonData.features.length + ' features' + (quickTestMode ? ' (quick test mode)' : ''))
    geo_utils.normalizeGeoJson(jsonData)

    // Insert all data
    const allFeatures = []
    turf.featureEach(jsonData, function (feature, featureIndex) {
      if (feature.geometry.type === 'MultiPolygon') {
        geo_utils.unionMergeMultiPolygon(feature)
      }
      feature.geogroup_id = _.get(feature, 'FieldID', undefined) || _.get(feature.properties, 'TelescopeName', '') + _.get(feature, 'id', '')

      // Prepare all values to insert in SQL DB
      const sqlValues = {}
      for (let i = 0; i < fieldsList.length; ++i) {
        const field = fieldsList[i]
        let d
        if (field.computed_compiled) {
          d = field.computed_compiled(feature.properties)
          if (isNaN(d)) d = undefined
        } else {
          d = _.get(feature.properties, field.id, undefined)
          if (d !== undefined && field.type === 'date') {
            d = new Date(d).getTime()
          }
        }
        sqlValues[sqlFields[i]] = d
      }

      const origProperties = feature.properties
      feature.properties = undefined
      turf.truncate(feature, {precision: 6, coordinates: 2, mutate: true})
      const newSubs = geo_utils.splitOnHealpixGrid(feature, HEALPIX_ORDER)
      let area = 0
      for (let j = 0; j < newSubs.length; ++j) {
        const subF = newSubs[j]
        assert(subF.geometry)
        const rotationMats = geo_utils.getHealpixRotationMats(HEALPIX_ORDER, subF.healpix_index)
        const subFrot = _.cloneDeep(subF)
        geo_utils.rotateGeojsonFeature(subFrot, rotationMats.m)
        subF.area = geo_utils.featureArea(subFrot)
        area += subF.area
        turf.truncate(subF, {precision: 6, coordinates: 2, mutate: true})
        subF.geometry = '__JSON' + JSON.stringify(subF.geometry)
        turf.truncate(subFrot, {precision: 6, coordinates: 2, mutate: true})
        subF.geometry_rot = '__JSON' + JSON.stringify(subFrot.geometry)
        subF.geogroup_id = feature.geogroup_id
        _.assign(subF, sqlValues)
      }
      feature.properties = origProperties
      const bCap = geo_utils.featureBoundingCap(feature)

      const f = {
        geogroup_id: feature.geogroup_id,
        properties: '__JSON' + JSON.stringify(feature.properties),
        geometry: '__JSON' + JSON.stringify(feature.geometry),
        area: area,
        geocap_x: bCap[0],
        geocap_y: bCap[1],
        geocap_z: bCap[2],
        geocap_cosa: bCap[3]
      }
      _.assign(f, sqlValues)

      allFeatures.push([f, newSubs])
    })

    // Prepare SQL insertion commands
    const insertOne = db.prepare('INSERT INTO features VALUES (@geometry, @geogroup_id, @area, @geocap_x, @geocap_y, @geocap_z, @geocap_cosa, @properties, ' + sqlFields.map(f => '@' + f).join(',') + ')')
    const insertSub = db.prepare('INSERT INTO subfeatures VALUES (@id, @geometry, @geometry_rot, @healpix_index, @geogroup_id, @area, ' + sqlFields.map(f => '@' + f).join(',') + ')')
    // Perform SQL transaction
    const insertMany = db.transaction(function (allF) {
      for (const i in allF) {
        const f = allF[i][0]
        const subFs = allF[i][1]
        // Insert one feature and get the unique rowid to assign it to the
        // id field of the subfeatures
        const info = insertOne.run(f)
        for (const subF of subFs) {
          subF.id = info.lastInsertRowid
          insertSub.run(subF)
        }
      }
    })
    insertMany(allFeatures)
    db.close()
  }

  static deinit () {
    if (QueryEngine.pool) return QueryEngine.pool.terminate(false, 10000)
  }
}

// Initialize the thread pool used to run async functions
if (workerpool.isMainThread) {
  QueryEngine.pool = workerpool.pool('./worker.mjs')
}
