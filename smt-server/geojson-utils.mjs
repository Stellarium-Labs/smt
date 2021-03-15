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

import _ from 'lodash'
import healpix from '@hscmap/healpix'
import turf from '@turf/turf'
import assert from 'assert'
import glMatrix from 'gl-matrix'

// Use native JS array in glMatrix lib
glMatrix.glMatrix.setMatrixArrayType(Array)

const D2R = Math.PI / 180
const R2D = 180 / Math.PI

const crossAntimeridian = function (feature) {
  let left = false
  let right = false

  turf.coordEach(feature, function (coord) {
    if (left && right) return
    let lng = coord[0]
    if (lng > 180) lng -= 360
    right = right || (lng >= 90)
    left = left || (lng <= -90)
  })
  return left && right
}

const geojsonPointToVec3 = function (p) {
  const lat = p[1] * D2R
  const lon = p[0] * D2R
  const v = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)]
  return v
}

const vec3TogeojsonPoint = function (v) {
  const lat = Math.asin(v[2])
  const lon = Math.atan2(v[1], v[0])
  return [lon * R2D, lat * R2D]
}

const rotateGeojsonPoint = function (p, m) {
  const v = geojsonPointToVec3(p)
  glMatrix.vec3.transformMat3(v, v, m)
  const p2 = vec3TogeojsonPoint(v)
  p[0] = p2[0]
  p[1] = p2[1]
}


const healpixCornerFeatureCache = {}
const healpixRotationMatsCache = {}
const healpixAreaCache = {}

export default {
  STERADIAN_TO_DEG2: (180 / Math.PI) * (180 / Math.PI),

  // Return the area of the feature in steradiant
  featureArea: function (feature) {
    return turf.area(feature) / (1000 * 1000) * 4 * Math.PI / 509600000
  },

  geojsonPointToVec3: geojsonPointToVec3,

  // Return the bounding cap for a feature
  featureBoundingCap: function (feature) {
    const v = geojsonPointToVec3(turf.centroid(feature).geometry.coordinates)
    let cosa = 1
    turf.coordEach(feature, function(coord) {
      const p = geojsonPointToVec3(coord)
      const cosAngle = v[0] * p[0] + v[1] * p[1] + v[2] * p[2]
      if (cosAngle < cosa) cosa = cosAngle
    })
    if (cosa <= -0.9999999) return [1, 0, 0, -1]
    return [v[0], v[1], v[2], cosa]
  },

  capContainsCap: function (cap1, cap2) {
    const d1 = cap1[3]
    const d2 = cap2[3]
    const a = glMatrix.vec3.dot(cap1, cap2) - d1 * d2
    return d1 <= d2 && (a >= 1.0 || (a >= 0.0 && a*a >= (1. - d1 * d1) * (1.0 - d2 * d2)))
  },

  // Return the smallest bounding cap which contains cap1 and cap2
  mergeCaps: function (cap1, cap2) {
    if (cap1[3] <= -0.9999999 || cap2[3] <= -0.9999999)
      return [1, 0, 0, -1]
    if (cap1[3] < cap2[3]) {
      if (this.capContainsCap(cap1, cap2)) return cap1
    } else {
      if (this.capContainsCap(cap2, cap1)) return cap2
    }
    const cap1Angle = Math.acos(cap1[3])
    const cap2Angle = Math.acos(cap2[3])
    const cap1Vec = glMatrix.vec3.fromValues(cap1[0], cap1[1], cap1[2])
    const cap2Vec = glMatrix.vec3.fromValues(cap2[0], cap2[1], cap2[2])
    console.assert(Math.abs(glMatrix.vec3.length(cap1Vec) - 1) < 0.0000001)
    console.assert(Math.abs(glMatrix.vec3.length(cap2Vec) - 1) < 0.0000001)
    const distAngle = Math.acos(glMatrix.vec3.dot(cap1Vec, cap2Vec))
    if (distAngle < 0.00000001)
      return [cap1[0], cap1[1], cap1[2], Math.min(cap1[3], cap2[3])]
    if (distAngle >= Math.PI - 0.00000001)
      return [1, 0, 0, -1]
    const newCapAngle = (cap1Angle + cap2Angle + distAngle) / 2
    console.assert(newCapAngle >= cap1Angle && newCapAngle >= cap2Angle)
    if (newCapAngle >= Math.PI)
      return [1, 0, 0, -1]
    let v = glMatrix.vec3.create()
    glMatrix.vec3.cross(v, cap1Vec, cap2Vec)
    glMatrix.vec3.normalize(v, v)
    let q = glMatrix.quat.create()
    glMatrix.quat.setAxisAngle(q, v, -cap1Angle + newCapAngle)
    glMatrix.vec3.transformQuat(v, cap1Vec, q)
    console.assert(Math.abs(glMatrix.vec3.length(v) - 1) < 0.0000001)
    return [v[0], v[1], v[2], Math.cos(newCapAngle)]
  },

  // Try to merge elements from a MultiPolygon into a single Polygon
  // This is useful if elements from a multipolygon overlap
  unionMergeMultiPolygon: function (feature) {
    assert(feature.geometry.type === 'MultiPolygon')
    let merged
    try {
      merged = turf.flattenReduce(feature, function (previousValue, currentFeature, featureIndex, multiFeatureIndex) {
        if (!previousValue)
          return currentFeature
        return turf.union(previousValue, currentFeature)
      })
    } catch (err) {
      // Can't merge this multipolygon, just give up
      // TODO try with rotation ?
      console.log('Error computing feature union: ' + err)
      return
    }
    if (merged.geometry.type === 'Polygon') {
      feature.geometry = merged.geometry
    }
  },

  normalizeGeoJson: function (geoData) {
    // Normalize coordinates between -180;180
    turf.coordEach(geoData, function(coord) {
      if (coord[0] > 180) coord[0] -= 360
    })

    // Shift polygons crossing antimeridian
    turf.geomEach(geoData, function(geom) {
      if (!crossAntimeridian(geom)) return
      turf.coordEach(geom, function(coord) {
        if (coord[0] < 0) coord[0] += 360
      })
    })
  },

  rotateGeojsonFeature: function (feature, m) {
    const ring = feature.geometry.type === 'MultiPolygon' ? feature.geometry.coordinates[0] : feature.geometry.coordinates
    const sameFirstLastPoint = ring[0][0] === ring[0][ring[0].length - 1]
    turf.coordEach(feature, p => {rotateGeojsonPoint(p, m)}, sameFirstLastPoint)
  },

  getHealpixCornerFeature: function (order, pix) {
    const cacheKey = '' + order + '_' + pix
    if (cacheKey in healpixCornerFeatureCache)
      return _.cloneDeep(healpixCornerFeatureCache[cacheKey])
    const mod = function(v, n) {
      return ( v + n ) % n
    }
    let corners = healpix.corners_nest(1 << order, pix)
    corners = corners.map(c => { return vec3TogeojsonPoint(c) })
//    for (let i = 0; i < corners.length; ++i) {
//      if (Math.abs(corners[i][1]) > 89.9999999) {
//        corners[i][0] = corners[mod(i + 1, corners.length)][0]
//        corners.splice(i, 0, [corners[mod(i - 1, corners.length)][0], corners[i][1]])
//        break
//      }
//    }
    corners.push(_.cloneDeep(corners[0]))
    let hppixel = turf.polygon([corners])
    this.normalizeGeoJson(hppixel)

    healpixCornerFeatureCache[cacheKey] = hppixel
    return _.cloneDeep(hppixel)
  },

  // Return the (varying!) area of a healpix pixel re-entered on 0,0 and
  // computed by turf
  getHealpixTurfArea: function (order, pix) {
    const cacheKey = '' + order + '_' + pix
    if (cacheKey in healpixAreaCache)
      return healpixAreaCache[cacheKey]
    const rm = this.getHealpixRotationMats(order, pix)
    const f = this.getHealpixCornerFeature(order, pix)
    this.rotateGeojsonFeature(f, rm.m)
    const area = this.featureArea(f)
    healpixAreaCache[cacheKey] = area
    return area
  },

  rotationMatsForShiftCenter: function (center) {
    let q = glMatrix.quat.create()
    glMatrix.quat.rotationTo(q, glMatrix.vec3.fromValues(center[0], center[1], center[2]), glMatrix.vec3.fromValues(1, 0, 0))
    const m = glMatrix.mat3.create()
    const mInv = glMatrix.mat3.create()
    glMatrix.mat3.fromQuat(m, q)
    glMatrix.mat3.invert(mInv, m)
    return {
      m: m,
      mInv: mInv
    }
  },

  getHealpixRotationMats: function (order, pix) {
    const cacheKey = '' + order + '_' + pix
    if (cacheKey in healpixRotationMatsCache)
      return healpixRotationMatsCache[cacheKey]

    let hppixel = this.getHealpixCornerFeature(order, pix)
    let shiftCenter = turf.centroid(hppixel)
    assert(shiftCenter)
    shiftCenter = shiftCenter.geometry.coordinates
    const center = geojsonPointToVec3(shiftCenter)
    const rotationMats = this.rotationMatsForShiftCenter(center)

    healpixRotationMatsCache[cacheKey] = rotationMats
    return rotationMats
  },

  computeCentroidHealpixIndex: function (feature, order) {
    let center = turf.centroid(feature)
    assert(center)
    center = center.geometry.coordinates
    if (center[0] < 0) center[0] += 360
    const theta = (90 - center[1]) * D2R
    const phi = center[0] * D2R
    assert((theta >= 0) && (theta <= Math.PI))
    assert(phi >= 0 && phi <= 2 * Math.PI)
    return healpix.ang2pix_nest(1 << order, theta, phi)
  },

  // Split the given feature in pieces on the healpix grid
  // Returns a list of features each with 'healpix_index' set to the matching
  // index.
  splitOnHealpixGrid: function (feature, order, alreadySplit) {
    const that = this
    let area = that.featureArea(feature)
    if (area * that.STERADIAN_TO_DEG2 < 0.00001) return []
    // For large footprints, we need to split the feature on quadrants
    if (area * that.STERADIAN_TO_DEG2 > 500 && !alreadySplit) {
      const allbbox = []
      const hsides = 8
      const vsides = hsides / 2
      const degStep = 360 / hsides
      for (let j = 0; j < vsides; ++j) {
        for (let i = 0; i < hsides * 2; ++i) {
          const bbox = [i * degStep - 180, j * degStep - 90, (i + 1) * degStep - 180, (j + 1) * degStep - 90]
          allbbox.push(bbox)
        }
      }
      let ret = {}
      turf.flattenEach(feature, function (feature2) {
        allbbox.forEach(function (bbox) {
          const box = {
            "type":"Feature",
            "properties":{},
            "geometry":{
              "type":"Polygon",
              "coordinates":[
                [
                  [bbox[0], bbox[1]],
                  [bbox[2], bbox[1]],
                  [bbox[2], bbox[3]],
                  [bbox[0], bbox[3]],
                  [bbox[0], bbox[1]]
                ]
              ]
            }
          }
          let clipped = turf.intersect(feature2, box)
          if (!clipped || turf.area(clipped) < 0.01) return
          turf.flattenEach(clipped, function (f2) {
            if (turf.area(f2) < 0.01) return
            let spl = that.splitOnHealpixGrid(f2, order, true)
            // Now that the large feature is split on the healpix grid
            // we still need to re-combine the features falling on the same
            // healpix pixel
            spl.forEach(f => {
              if (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon') return
              that.normalizeGeoJson(f)
              if (f.healpix_index in ret) {
                try {
                  ret[f.healpix_index] = turf.union(ret[f.healpix_index], f)
                  ret[f.healpix_index].healpix_index = f.healpix_index
                } catch (err) {
                  console.log('Error while doing union:' + err)
                }
              } else {
                ret[f.healpix_index] = f
              }
            })
          })
        })
      })
      ret = Object.values(ret)
      return ret
    }
    let center = turf.centroid(feature)
    assert(center)
    center = center.geometry.coordinates
    let radius = 0
    turf.coordEach(feature, (coord) => {
      const d = turf.distance(coord, center, {units: 'radians'})
      if (d > radius) radius = d
    })

    const v = geojsonPointToVec3(center)
    const ret = []
    healpix.query_disc_inclusive_nest(1 << order, v, radius, function (pix) {
      const hppixel = that.getHealpixCornerFeature(order, pix)
      const rotationMats = that.getHealpixRotationMats(order, pix)
      const intersection = that.intersectionRobust(feature, hppixel, rotationMats)
      if (intersection === null) return
      const f = _.cloneDeep(feature)
      f['healpix_index'] = pix
      f.geometry = intersection.geometry
      ret.push(f)
    })
    return ret
  },

  intersectionRobust: function (feature1, feature2, rotationMats) {
    const that = this
    assert(feature2.geometry.type === 'Polygon')
    if (feature1.geometry.type === 'MultiPolygon') {
      const featuresCollection = turf.flatten(feature1)
      let featuresIntersected = []
      turf.featureEach(featuresCollection, f => { const inte = that.intersectionRobust(f, feature2, rotationMats); if (inte) featuresIntersected.push(inte) })
      if (featuresIntersected.length === 0) return null
      const combinedFc = turf.combine(turf.featureCollection(featuresIntersected))
      assert(combinedFc.features.length === 1)
      const f = _.cloneDeep(feature1)
      f.geometry = combinedFc.features[0].geometry
      assert(f.geometry)
      return f
    }

    assert(feature1.geometry.type === 'Polygon')

    const f1 = _.cloneDeep(feature1)
    const f2 = _.cloneDeep(feature2)
    this.rotateGeojsonFeature(f1, rotationMats.m)
    this.rotateGeojsonFeature(f2, rotationMats.m)
    let res = null
    try {
      res = turf.intersect(f1, f2)
      if (res) that.rotateGeojsonFeature(res, rotationMats.mInv)
    } catch (err) {
      let ff1
      try {
        assert(turf.unkinkPolygon(turf.cleanCoords(f2)).features.length === 1)
        ff1 = turf.unkinkPolygon(turf.cleanCoords(f1))
        let arr = []
        turf.flattenEach(ff1, function (f) {
          if (turf.area(f) < 0.00001) return
          const r = turf.intersect(f, f2)
          if (r) {
            that.rotateGeojsonFeature(r, rotationMats.mInv)
            arr.push(r)
          }
        })
        res = null
        if (arr.length) {
          res = arr[0]
          for (let i = 1; i < arr.length; ++i) {
            res = turf.union(res, arr[i])
          }
        }
      } catch (err) {
        console.log('Error computing feature intersection: ' + err)
        res = null
      }
    }
    assert(res === null || res.geometry)
    return res
  },

  multiUnion: function (features, stopFunc, postFunc) {
    if (stopFunc() === true) return null
    if (features.length === 1) {
      postFunc(features[0])
      return features[0]
    }

    if (features.length <= 2) {
      try {
        const union = turf.union(...features)
        turf.truncate(union, {precision: 6, coordinates: 2, mutate: true})
        postFunc(union)
        return union
      } catch {
        return null
      }
    }
    let a = features.slice(0, features.length / 2)
    let b = features.slice(features.length / 2)
    a = this.multiUnion(a, stopFunc, postFunc)
    b = this.multiUnion(b, stopFunc, postFunc)
    if (!a && !b) return null
    if (!a) return b
    if (!b) return a
    try {
      const union = turf.union(a, b)
      turf.truncate(union, {precision: 6, coordinates: 2, mutate: true})
      postFunc(union)
      return union
    } catch {
      return null
    }
  }
}

