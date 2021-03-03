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

const HEALPIX_ORDER = 5
const __dirname = process.cwd()

const fId2SqlId = function (fieldId) {
  return fieldId.replace(/\./g, '_')
}

const fType2SqlType = function (fieldType) {
  if (fieldType === 'string') return 'TEXT'
  if (fieldType === 'date') return 'INT' // Dates are converted to unix time stamp
  if (fieldType === 'number') return 'NUMERIC'
  return 'JSON'
}

const postProcessSQLiteResult = function (res)  {
  for (const i in res) {
    const item = res[i]
    if (typeof item === 'string' && item.startsWith('__JSON'))
      res[i] = JSON.parse(item.substring(6))
  }
}

export default {

  // All these variable are initialized by the init() function
  fieldsList: undefined,
  fieldsMap: undefined,
  db: undefined,
  dbFileName: undefined,

  // Internal counter used to assign IDs
  fcounter: 0,

  init: function (dbFileName) {
    let that = this
    assert(fs.existsSync(dbFileName))
    that.dbFileName = dbFileName
    console.log('Opening existing Data Base (read only): ' + dbFileName)
    const db = new Database(dbFileName, { readonly: true });
    const smtConfig = JSON.parse(db.prepare('SELECT data from smtConfig').get().data)

    // Initialize modules's attributes based on the config file
    that.fieldsList = _.cloneDeep(smtConfig.fields)
    that.fieldsMap = {}
    for (let i in that.fieldsList) {
      that.fieldsMap[that.fieldsList[i].id] = that.fieldsList[i]
      if (that.fieldsList[i].computed) {
        let options = {
          extraFunctions: { date2unix: function (dstr) { return new Date(dstr).getTime() } },
          customProp: (path, unused, obj) => _.get(obj, path, undefined)
        }
        that.fieldsList[i].computed_compiled = filtrex.compileExpression(that.fieldsList[i].computed, options)
      }
    }
    // Add dummy entries matching our generated fields
    that.fieldsMap['id'] = { type: 'string' }
    that.fieldsMap['healpix_index'] = { type: 'number' }
    that.fieldsMap['geogroup_id'] = { type: 'string' }

    // Add a custom aggregation operator for the chip tags
    db.aggregate('VALUES_AND_COUNT', {
      start: () => {},
      step: (accumulator, value) => {
        if (!accumulator) accumulator = {}
        if (!value) value = '__undefined'
        accumulator[value] = (accumulator[value] !== undefined) ? accumulator[value] + 1 : 1
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

    db.aggregate('GEO_UNION', {
      start: undefined,
      step: (accumulator, value) => {
        console.assert(typeof value === 'string' && value.startsWith('__JSON'))
        value = JSON.parse(value.substring(6))
        if (!accumulator) {
          const feature = {
            "type": "Feature",
            "geometry": value
          }
          const shiftCenter = turf.pointOnFeature(feature).geometry.coordinates

          // Compute shift matrices
          const center = geo_utils.geojsonPointToVec3(shiftCenter)
          const mats = geo_utils.rotationMatsForShiftCenter(center)
          feature.m = mats.m
          feature.mInv = mats.mInv
          geo_utils.rotateGeojsonFeature(feature, feature.m)
          return feature
        }
        try {
          const f2 =  {
            "type": "Feature",
            "geometry": value
          }
          geo_utils.rotateGeojsonFeature(f2, accumulator.m)
          const union = turf.union(accumulator, f2)
          accumulator.geometry = union.geometry
          return accumulator
        } catch (err) {
          console.log('Error computing feature union: ' + err)
          return accumulator
        }
      },
      result: accumulator => {
        if (!accumulator)
          return undefined
        geo_utils.rotateGeojsonFeature(accumulator, accumulator.mInv)
        return '__JSON' + JSON.stringify(accumulator.geometry)
      }
    })

    that.db = db

    // Initialize the thread pool used to run async functions
    if (workerpool.isMainThread)
      this.pool = workerpool.pool('./worker.mjs')
  },

  // A worker pool
  pool: undefined,

  queryAsync: function (...parameters) {
    return this.pool.exec('query', [this.dbFileName].concat(parameters))
  },

  getHipsTileAsync: function (...parameters) {
    return this.pool.exec('getHipsTile', [this.dbFileName].concat(parameters))
  },

  generateDb: function (dataDir, dbFileName) {
    const that = this
    // Create the DB file and ingest everything, but dont intialize this object
    // at all, another call to init() is necessary for this.
    const dbAlreadyExists = fs.existsSync(dbFileName)
    if (dbAlreadyExists) {
      // supress previous DB
      console.log('Suppress existind DB at: ' + dbFileName)
      fs.unlinkSync(dbFileName)
    }
    console.log('Create new Data Base: ' + dbFileName)
    const db = new Database(dbFileName)
    const smtConfig = JSON.parse(fs.readFileSync(dataDir + '/smtConfig.json'))

    // Initialize modules's attributes based on the config file
    const fieldsList = _.cloneDeep(smtConfig.fields)
    const sqlFields = fieldsList.map(f => fId2SqlId(f.id))

    // Initialize DB structure

    // Save config file inside the DB
    db.prepare('CREATE TABLE smtconfig (data TEXT)').run()
    db.prepare('INSERT INTO smtconfig (data) VALUES (?)').run(JSON.stringify(smtConfig))

    const sqlFieldsAndTypes = fieldsList.map(f => fId2SqlId(f.id) + ' ' + fType2SqlType(f.type)).join(', ')
    db.prepare('CREATE TABLE features (id TEXT, geometry TEXT, geogroup_id TEXT, properties TEXT, ' + sqlFieldsAndTypes + ')').run()
    db.prepare('CREATE INDEX idx_id ON features(id)').run()
    db.prepare('CREATE INDEX idx_geogroup_id ON features(geogroup_id)').run()

    db.prepare('CREATE TABLE subfeatures (id TEXT, geometry TEXT, healpix_index INT, geogroup_id TEXT, ' + sqlFieldsAndTypes + ')').run()
    db.prepare('CREATE INDEX idxsub_id ON subfeatures(id)').run()
    db.prepare('CREATE INDEX idxsub_geogroup_id ON subfeatures(geogroup_id)').run()
    db.prepare('CREATE INDEX idxsub_healpix_index ON subfeatures(healpix_index)').run()

    // Create an index on each field
    for (let i in sqlFields) {
      const field = sqlFields[i]
      db.prepare('CREATE INDEX idx_' + i + ' ON features(' + field + ')').run()
      db.prepare('CREATE INDEX idxsub_' + i + ' ON subfeatures(' + field + ')').run()
    }
    db.close()

    // Ingest all geojson files listed in the smtConfig
    smtConfig.sources.map(url => that.ingestGeoJson(dbFileName, dataDir + '/' + url))
  },

  // Ingest geojson file fileName into the database at dbFileName
  ingestGeoJson: function (dbFileName, fileName) {
    const that = this
    const jsonData = JSON.parse(fs.readFileSync(fileName))
    const dbAlreadyExists = fs.existsSync(dbFileName)
    assert(dbAlreadyExists)

    const db = new Database(dbFileName)

    const smtConfig = JSON.parse(db.prepare('SELECT data from smtConfig').get().data)
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
    let subFeatures = []
    let allFeatures = []
    turf.featureEach(jsonData, function (feature, featureIndex) {
      if (feature.geometry.type === 'MultiPolygon') {
        geo_utils.unionMergeMultiPolygon(feature)
      }
      feature.geogroup_id = _.get(feature, 'FieldID', undefined) || _.get(feature.properties, 'TelescopeName', '') + _.get(feature, 'id', '')
      feature.id = that.fcounter++

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

      const f = {
        id: feature.id,
        geogroup_id: feature.geogroup_id,
        properties: '__JSON' + JSON.stringify(feature.properties),
        geometry: '__JSON' + JSON.stringify(feature.geometry)
      }
      _.assign(f, sqlValues)
      allFeatures.push(f)

      const origProperties = feature.properties
      feature.properties = undefined
      const newSubs = geo_utils.splitOnHealpixGrid(feature, HEALPIX_ORDER)
      for (let j = 0; j < newSubs.length; ++j) {
        const subF = newSubs[j]
        assert(subF.geometry)
        subF.geometry = '__JSON' + JSON.stringify(subF.geometry)
        subF.geogroup_id = feature.geogroup_id
        subF.id = feature.id
        _.assign(subF, sqlValues)
      }
      subFeatures = subFeatures.concat(newSubs)
      feature.properties = origProperties
    })

    const insert = db.prepare('INSERT INTO features VALUES (@id, @geometry, @geogroup_id, @properties, ' + sqlFields.map(f => '@' + f).join(',') + ')')
    const insertMany = db.transaction((features) => {
      for (const feature of features)
        insert.run(feature)
    })
    insertMany(allFeatures)

    const insertSub = db.prepare('INSERT INTO subfeatures VALUES (@id, @geometry, @healpix_index, @geogroup_id, ' + sqlFields.map(f => '@' + f).join(',') + ')')
    const insertManySub = db.transaction((features) => {
      for (const feature of features)
        insertSub.run(feature)
    })
    insertManySub(subFeatures)
    db.close()
  },

  // Construct the SQL WHERE clause matching the given constraints
  constraints2SQLWhereClause: function (constraints) {
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
        let fType = that.fieldsMap[c.fieldId] ? that.fieldsMap[c.fieldId].type : undefined
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
  },

  // Query the engine
  query: function (q) {
    let that = this
    let whereClause = this.constraints2SQLWhereClause(q.constraints)

    if (q.limit && Number.isInteger(q.limit)) {
      whereClause += ' LIMIT ' + q.limit
    }
    if (q.skip && Number.isInteger(q.skip)) {
      whereClause += ' FETCH ' + q.skip
    }

    // Construct the SQL SELECT clause matching the given aggregate options
    let selectClause = 'SELECT '
    if (q.projectOptions) {
      selectClause += Object.keys(q.projectOptions).map(k => fId2SqlId(k)).join(', ')
    }

    const fromClause = ' FROM features'

    if (q.aggregationOptions) {
      // We can't do much more than group all using SQL language
      console.assert(q.groupingOptions.length === 1 && q.groupingOptions[0].operation === 'GROUP_ALL')
      for (let i in q.aggregationOptions) {
        let agOpt = q.aggregationOptions[i]
        console.assert(agOpt.out)
        if (agOpt.operation === 'COUNT') {
          selectClause += 'COUNT(*) as ' + agOpt.out
        } else if (agOpt.operation === 'VALUES_AND_COUNT') {
          selectClause += 'VALUES_AND_COUNT(' + fId2SqlId(agOpt.fieldId) + ') as ' + agOpt.out
        } else if (agOpt.operation === 'MIN_MAX') {
          selectClause += 'MIN_MAX(' + fId2SqlId(agOpt.fieldId) + ') as ' + agOpt.out
        } else if (agOpt.operation === 'DATE_HISTOGRAM') {
          // Special case, do custom queries and return
          console.assert(q.aggregationOptions.length === 1)
          let fid = fId2SqlId(agOpt.fieldId)
          let wc = (whereClause === '') ? ' WHERE ' + fid + ' IS NULL' : whereClause + ' AND ' + fid + ' IS NULL'
          let req = 'SELECT COUNT(*) AS c ' + fromClause + wc
          let res = that.db.prepare(req).get()
          const null_count = res.c
          wc = (whereClause === '') ? ' WHERE ' + fid + ' IS NOT NULL' : whereClause + ' AND ' + fid + ' IS NOT NULL'
          req = 'SELECT MIN(' + fid + ') AS dmin, MAX(' + fid + ') AS dmax ' + fromClause + wc
          res = that.db.prepare(req).get()
          postProcessSQLiteResult(res)
          if (!res.dmin || !res.dmax) {
            // No results
            let data = {
              noval: null_count,
              min: undefined,
              max: undefined,
              step: '%Y-%m-%d',
              table: [['Date', 'Count']]
            }
            let retd = {}
            retd[agOpt.out] = data
            return { q: q, res: [retd] }
          }
          let start = new Date(res.dmin)
          start.setUTCHours(0, 0, 0, 0)
          // Switch to next day and truncate
          let stop = new Date(res.dmax + 1000 * 60 * 60 * 24)
          stop.setUTCHours(23, 59, 59, 0)
          // Range in days
          let range = (stop - start) / (1000 * 60 * 60 * 24)
          let step = '%Y-%m-%d'
          if (range > 3 * 365) {
            step = '%Y'
          } else if (range > 3 * 30) {
            step = '%Y-%m'
          }

          // Adjust min max so that they fall on an integer number of month/year
          if (step === '%Y-%m-%d') {
            // Min max already OK
          } else if (step === '%Y-%m') {
            start.setUTCDate(1)
            stop.setUTCMonth(stop.getUTCMonth() + 1, 0)
          } else if (step === '%Y') {
            start.setUTCMonth(0)
            stop.setUTCFullYear(stop.getUTCFullYear(), 11, 31)
          }

          let sqlQ = 'SELECT COUNT(*) AS c, STRFTIME(\'' + step + '\', ROUND(' + fid + '/1000), \'unixepoch\') AS d ' + fromClause + wc + ' GROUP BY STRFTIME(\'' + step + '\', ROUND(' + fid + '/1000), \'unixepoch\')'
          const res2 = that.db.prepare(sqlQ).all()
          let data = {
            noval: null_count,
            min: start,
            max: stop,
            step: step,
            table: [['Date', 'Count']]
          }

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
          for (let j in res2) {
            postProcessSQLiteResult(res2[j])
            tmpTable[res2[j].d] = res2[j].c
          }
          Object.keys(tmpTable).forEach(function (key) {
            data.table.push([key, tmpTable[key]])
          })
          let retd = {}
          retd[agOpt.out] = data
          return { q: q, res: [retd] }
        } else if (agOpt.operation === 'NUMBER_HISTOGRAM') {
          // Special case, do custom queries and return
          console.assert(q.aggregationOptions.length === 1)
          let fid = fId2SqlId(agOpt.fieldId)
          let wc = (whereClause === '') ? ' WHERE ' + fid + ' IS NULL' : whereClause + ' AND ' + fid + ' IS NULL'
          let req = 'SELECT COUNT(*) AS c ' + fromClause + wc
          let res = that.db.prepare(req).get()
          const null_count = res.c
          wc = (whereClause === '') ? ' WHERE ' + fid + ' IS NOT NULL' : whereClause + ' AND ' + fid + ' IS NOT NULL'
          req = 'SELECT MIN(' + fid + ') AS dmin, MAX(' + fid + ') AS dmax ' + fromClause + wc
          res = that.db.prepare(req).get()
          postProcessSQLiteResult(res)
          if (res.dmin === res.dmax) {
            if (res.dmin === null) res.dmin = undefined
            if (res.dmax === null) res.dmax = undefined
            // No results
            let data = {
              noval: null_count,
              min: res.dmin,
              max: res.dmax,
              step: undefined,
              table: [['Value', 'Count']]
            }
            let retd = {}
            retd[agOpt.out] = data
            return { q: q, res: [retd] }
          }
          let step = (res.dmax - res.dmin) / 10

          let sqlQ = 'SELECT COUNT(*) AS c, ROUND((' + fid + ' - ' + res.dmin + ') / ' + step + ') * ' + step + ' + ' + res.dmin + ' AS d ' + fromClause + wc + ' GROUP BY ROUND((' + fid + ' - ' + res.dmin + ') / ' + step + ')'
          const res2 = that.db.prepare(sqlQ).all()
          let data = {
            noval: null_count,
            min: res.dmin,
            max: res.dmax,
            step: step,
            table: [['Value', 'Count']]
          }

          let tmpTable = {}
          // Prefill the table to make sure that all steps do have a value
          for (let d = res.dmin; d < res.dmax; d += step) {
            tmpTable['' + d] = 0
          }
          for (let j in res2) {
            postProcessSQLiteResult(res2[j])
            tmpTable['' + res2[j].d] = res2[j].c
          }
          let keys = Object.keys(tmpTable)
          keys.sort((a, b) => parseFloat(a) - parseFloat(b))
          keys.forEach(function (key) {
            data.table.push([key, tmpTable[key]])
          })
          let retd = {}
          retd[agOpt.out] = data
          return { q: q, res: [retd] }
        } else {
          throw new Error('Unsupported aggregation operation: ' + agOpt.operation)
        }
      }
    }

    let sqlStatement = selectClause + fromClause + whereClause
    const res = that.db.prepare(sqlStatement).all()
    for (let i in res) {
      postProcessSQLiteResult(res[i])
    }
    return { q: q, res: res }
  },

  getHipsProperties: function () {
    return `hips_tile_format = geojson\nhips_order = 2\nhips_order_min = 1` +
        '\nhips_tile_width = 400\nobs_title = SMT Geojson'
  },

  getHipsTile: function (q, order, tileId) {
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
    selectClause += this.fieldsList.filter(f => f.widget !== 'tags').map(f => fId2SqlId(f.id)).map(k => 'MIN_MAX(' + k + ') as ' + k).join(', ')
    selectClause += ', ' + this.fieldsList.filter(f => f.widget === 'tags').map(f => fId2SqlId(f.id)).map(k => 'VALUES_AND_COUNT(' + k + ') as ' + k).join(', ')
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
    const stmt = that.db.prepare(sqlStatement)
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
}
