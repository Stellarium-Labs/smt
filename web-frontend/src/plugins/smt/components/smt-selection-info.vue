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

<template>
  <v-container v-if="selectionData !== undefined" class="pa-0 smt-selection-box">
    <v-card style="background: rgba(66, 66, 66, 0.7)">
      <v-btn icon style="position: absolute; right: 0" v-on:click="unselect()"><v-icon>mdi-close</v-icon></v-btn>
      <v-card-title>
        <div class="headline">Footprint {{ currentIndex + 1 }} / {{ selectionData ? selectionData.count : 0 }}
          <v-btn icon v-on:click="decIndex()"><v-icon>mdi-chevron-left</v-icon></v-btn>
          <v-btn icon v-on:click="incIndex()"><v-icon>mdi-chevron-right</v-icon></v-btn>
        </div>
      </v-card-title>
      <v-card-text>
        <template v-for="(item) in currentItem.fields">
          <v-row style="width: 100%" :key="item.field.id" no-gutters>
            <v-col cols="4" style="color: #dddddd">
              <v-tooltip v-if="item.field.description" top max-width="300" color="#000000">
                <template v-slot:activator="{ on, attrs }">
                  <span :class="{dottedUnderline: item.field.description}" v-bind="attrs" v-on="on">{{ item.field.name }}</span>
                </template>
                <div v-html="item.field.description_html"></div>
              </v-tooltip>
              <span v-else>{{ item.field.name }}</span>
            </v-col>
            <v-col cols="8" style="font-weight: 500" class="white--text"><span v-html="item.value"></span></v-col>
          </v-row>
        </template>
        <v-row style="width: 100%" no-gutters>
          <v-col cols="4" style="color: #dddddd">properties</v-col>
          <v-col cols="8" class="white--text"><vue-json-pretty :data="currentItem.properties" :deep="0" :showLength="true" :showDoubleQuotes="false"></vue-json-pretty></v-col>
        </v-row>
      </v-card-text>
    </v-card>
  </v-container>
</template>

<script>
import VueJsonPretty from 'vue-json-pretty'
import qe from '../query-engine'

export default {
  data: function () {
    return {
      currentIndex: 0,
      selectionData: undefined
    }
  },
  props: ['selectedFeatures', 'query'],
  computed: {
    currentItem: function () {
      if (!this.selectionData || !this.selectionData.features.length) return { fields: [], properties: {} }
      const props = this.selectionData.features[this.currentIndex].properties
      const ret = { fields: {}, properties: props }
      for (const key in props) {
        const field = this.$smt.fields.find(f => f.id === key)
        if (field) ret.fields[field.name] = { field: field, value: props[key] }
      }
      return ret
    }
  },
  beforeDestroy: function () {
    this.clearFootprint()
  },
  methods: {
    unselect: function () {
      this.$emit('unselect')
    },
    decIndex: function () {
      if (this.currentIndex === 0) this.currentIndex = this.selectionData.features.length - 1
      else this.currentIndex--
    },
    incIndex: function () {
      if (this.currentIndex >= this.selectionData.features.length - 1) this.currentIndex = 0
      else this.currentIndex++
    },
    clearFootprint: function () {
      if (this.geojsonObj) {
        this.$observingLayer.remove(this.geojsonObj)
        this.geojsonObj.destroy()
        this.geojsonObj = undefined
      }
    },
    refreshFootprint: function () {
      this.clearFootprint()
      if (!this.selectionData || !this.selectionData.features) return
      const feature = this.selectionData.features[this.currentIndex]
      const geojson = {
        type: 'FeatureCollection',
        features: [{
          geometry: feature.geometry,
          type: 'Feature',
          properties: {}
        }]
      }
      this.geojsonObj = this.$stel.createObj('geojson')
      this.geojsonObj.setData(geojson)
      this.$observingLayer.add(this.geojsonObj)
      this.geojsonObj.filter = function (id) {
        return {
          fill: [1, 1, 1, 0.05],
          stroke: [1, 1, 1, 1],
          hidden: false,
          blink: false
        }
      }
    }
  },
  watch: {
    selectedFeatures: function () {
      const that = this
      this.currentIndex = 0
      if (!this.selectedFeatures || !this.selectedFeatures.length) {
        this.selectionData = undefined
        return
      }

      let featuresCount = 0
      this.selectedFeatures.forEach(f => { featuresCount += f.geogroup_size })
      const geogroupIds = this.selectedFeatures.map(f => f.geogroup_id)
      const q = {
        constraints: [
          { fieldId: 'geogroup_id', operation: 'IN', expression: geogroupIds, negate: false }
        ],
        projectOptions: {
          properties: 1,
          geometry: 1
        },
        limit: 500
      }
      q.constraints = that.query.constraints.concat(q.constraints)
      qe.query(q).then(qres => {
        that.currentIndex = 0
        if (!qres.res.length) {
          that.selectionData = undefined
          return
        }
        that.selectionData = {
          count: featuresCount,
          features: qres.res
        }
        that.refreshFootprint()
        console.assert(featuresCount === qres.res.length)
      })
    },
    currentIndex: function () {
      this.refreshFootprint()
    },
    selectionData: function () {
      this.refreshFootprint()
    }
  },
  components: { VueJsonPretty }
}
</script>

<style>
.smt-selection-box {
  position: fixed;
  left: 5px;
  top: 53px;
  width: 450px;
  max-height: calc(100% - 150px);
  overflow-y: auto;
  backface-visibility: hidden;
}

.dottedUnderline {
  border-bottom: 1px dotted;
  border-color: #888888;
}
</style>
