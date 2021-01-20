// Stellarium Web - Copyright (c) 2021 - Stellarium Labs SAS
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
  <div style="height: 100%; display: flex; flex-flow: column;">
    <smt-selection-info :selectedFeatures="selectedFootprintData" :query="query" @unselect="unselect()"></smt-selection-info>
    <v-card tile color="#424242">
      <v-card-text>
          <v-row no-gutters>
            <v-col cols="1"><div style="padding-top: 7px;">Color</div></v-col>
            <v-col cols="5">
              <div>
              <v-menu close-on-click>
                <template v-slot:activator="{ on, attrs }">
                  <v-btn x-small text elevation="3" dark v-bind="attrs" v-on="on">{{colorAssignedField.name}} <v-icon right>mdi-menu-down</v-icon></v-btn>
                </template>
                <v-list>
                  <v-list-item v-for="(item, index) in $smt.fields" :key="index" @click="colorAssignedField = item">
                    <v-list-item-title>{{ item.name }}</v-list-item-title>
                  </v-list-item>
                </v-list>
              </v-menu>
              </div>
            </v-col>
            <v-col cols="2"><div class="pr-1 text-right" style="padding-top: 7px;">Opacity</div></v-col>
            <v-col cols="4">
              <v-slider dense max="255" min="0" v-model="opacitySliderValue"></v-slider>
            </v-col>
          </v-row>
        <div class="display-1 text--primary">
          <v-progress-circular v-if="results.summary.count === undefined" size=18 indeterminate></v-progress-circular>
          {{ results.summary.count }} items
        </div>
        <div v-if="constraintsToDisplay.length" class="mt-2">Constraints:</div>
        <v-row no-gutters>
          <div v-for="(constraint, i) in constraintsToDisplay" :key="i" style="text-align: center;" class="pa-1">
            <div class="caption white--text">{{ constraint.field.name }}</div>
            <v-chip small class="white--text" :close="constraint.closable" :disabled="!constraint.closable" :color="constraint.color ? constraint.color : 'primary'" @click="constraintClicked(i)" @click:close="constraintClosed(i)">
            <div :style="{ minWidth: constraint.closable ? 60 : 82 + 'px' }"><span v-if="printConstraint(constraint) === '__undefined'"><i>Undefined</i></span><span v-else>{{ printConstraint(constraint) }}</span></div>
            </v-chip>
          </div>
        </v-row>
      </v-card-text>
    </v-card>
    <div class="scroll-container">
      <v-container class="pl-0 pr-0 pt-0" fluid style="height: 100%">
        <v-container class="pt-0">
          <smt-field class="mb-2" v-for="fr in resultsFieldsToDisplay" :key="fr.field.id" :fieldDescription="fr.field" :fieldResults="fr" v-on:add-constraint="addConstraint" v-on:remove-constraint="removeConstraint" v-on:constraint-live-changed="constraintLiveChanged">
          </smt-field>
        </v-container>
      </v-container>
    </div>
  </div>
</template>

<script>
import SmtField from './smt-field.vue'
import SmtSelectionInfo from './smt-selection-info.vue'
import Vue from 'vue'
import Moment from 'moment'
import murmurhash from 'murmurhash'
import qe from '../query-engine'
import _ from 'lodash'

const stringHash = function (str) {
  return murmurhash.v2(str + 'Stellarium Labs')
}

// From https://stackoverflow.com/questions/5623838/rgb-to-hex-and-hex-to-rgb
const componentToHex = function (c) {
  const hex = c.toString(16)
  return hex.length === 1 ? '0' + hex : hex
}
const rgbToHex = function (r, g, b) {
  return '#' + componentToHex(r) + componentToHex(g) + componentToHex(b)
}

// Turbo Color map as defined in
// https://ai.googleblog.com/2019/08/turbo-improved-rainbow-colormap-for.html
const turboSrgb = [[48, 18, 59], [50, 21, 67], [51, 24, 74], [52, 27, 81], [53, 30, 88], [54, 33, 95], [55, 36, 102], [56, 39, 109], [57, 42, 115], [58, 45, 121], [59, 47, 128], [60, 50, 134], [61, 53, 139], [62, 56, 145], [63, 59, 151], [63, 62, 156], [64, 64, 162], [65, 67, 167], [65, 70, 172], [66, 73, 177], [66, 75, 181], [67, 78, 186], [68, 81, 191], [68, 84, 195], [68, 86, 199], [69, 89, 203], [69, 92, 207], [69, 94, 211], [70, 97, 214], [70, 100, 218], [70, 102, 221], [70, 105, 224], [70, 107, 227], [71, 110, 230], [71, 113, 233], [71, 115, 235], [71, 118, 238], [71, 120, 240], [71, 123, 242], [70, 125, 244], [70, 128, 246], [70, 130, 248], [70, 133, 250], [70, 135, 251], [69, 138, 252], [69, 140, 253], [68, 143, 254], [67, 145, 254], [66, 148, 255], [65, 150, 255], [64, 153, 255], [62, 155, 254], [61, 158, 254], [59, 160, 253], [58, 163, 252], [56, 165, 251], [55, 168, 250], [53, 171, 248], [51, 173, 247], [49, 175, 245], [47, 178, 244], [46, 180, 242], [44, 183, 240], [42, 185, 238], [40, 188, 235], [39, 190, 233], [37, 192, 231], [35, 195, 228], [34, 197, 226], [32, 199, 223], [31, 201, 221], [30, 203, 218], [28, 205, 216], [27, 208, 213], [26, 210, 210], [26, 212, 208], [25, 213, 205], [24, 215, 202], [24, 217, 200], [24, 219, 197], [24, 221, 194], [24, 222, 192], [24, 224, 189], [25, 226, 187], [25, 227, 185], [26, 228, 182], [28, 230, 180], [29, 231, 178], [31, 233, 175], [32, 234, 172], [34, 235, 170], [37, 236, 167], [39, 238, 164], [42, 239, 161], [44, 240, 158], [47, 241, 155], [50, 242, 152], [53, 243, 148], [56, 244, 145], [60, 245, 142], [63, 246, 138], [67, 247, 135], [70, 248, 132], [74, 248, 128], [78, 249, 125], [82, 250, 122], [85, 250, 118], [89, 251, 115], [93, 252, 111], [97, 252, 108], [101, 253, 105], [105, 253, 102], [109, 254, 98], [113, 254, 95], [117, 254, 92], [121, 254, 89], [125, 255, 86], [128, 255, 83], [132, 255, 81], [136, 255, 78], [139, 255, 75], [143, 255, 73], [146, 255, 71], [150, 254, 68], [153, 254, 66], [156, 254, 64], [159, 253, 63], [161, 253, 61], [164, 252, 60], [167, 252, 58], [169, 251, 57], [172, 251, 56], [175, 250, 55], [177, 249, 54], [180, 248, 54], [183, 247, 53], [185, 246, 53], [188, 245, 52], [190, 244, 52], [193, 243, 52], [195, 241, 52], [198, 240, 52], [200, 239, 52], [203, 237, 52], [205, 236, 52], [208, 234, 52], [210, 233, 53], [212, 231, 53], [215, 229, 53], [217, 228, 54], [219, 226, 54], [221, 224, 55], [223, 223, 55], [225, 221, 55], [227, 219, 56], [229, 217, 56], [231, 215, 57], [233, 213, 57], [235, 211, 57], [236, 209, 58], [238, 207, 58], [239, 205, 58], [241, 203, 58], [242, 201, 58], [244, 199, 58], [245, 197, 58], [246, 195, 58], [247, 193, 58], [248, 190, 57], [249, 188, 57], [250, 186, 57], [251, 184, 56], [251, 182, 55], [252, 179, 54], [252, 177, 54], [253, 174, 53], [253, 172, 52], [254, 169, 51], [254, 167, 50], [254, 164, 49], [254, 161, 48], [254, 158, 47], [254, 155, 45], [254, 153, 44], [254, 150, 43], [254, 147, 42], [254, 144, 41], [253, 141, 39], [253, 138, 38], [252, 135, 37], [252, 132, 35], [251, 129, 34], [251, 126, 33], [250, 123, 31], [249, 120, 30], [249, 117, 29], [248, 114, 28], [247, 111, 26], [246, 108, 25], [245, 105, 24], [244, 102, 23], [243, 99, 21], [242, 96, 20], [241, 93, 19], [240, 91, 18], [239, 88, 17], [237, 85, 16], [236, 83, 15], [235, 80, 14], [234, 78, 13], [232, 75, 12], [231, 73, 12], [229, 71, 11], [228, 69, 10], [226, 67, 10], [225, 65, 9], [223, 63, 8], [221, 61, 8], [220, 59, 7], [218, 57, 7], [216, 55, 6], [214, 53, 6], [212, 51, 5], [210, 49, 5], [208, 47, 5], [206, 45, 4], [204, 43, 4], [202, 42, 4], [200, 40, 3], [197, 38, 3], [195, 37, 3], [193, 35, 2], [190, 33, 2], [188, 32, 2], [185, 30, 2], [183, 29, 2], [180, 27, 1], [178, 26, 1], [175, 24, 1], [172, 23, 1], [169, 22, 1], [167, 20, 1], [164, 19, 1], [161, 18, 1], [158, 16, 1], [155, 15, 1], [152, 14, 1], [149, 13, 1], [146, 11, 1], [142, 10, 1], [139, 9, 2], [136, 8, 2], [133, 7, 2], [129, 6, 2], [126, 5, 2], [122, 4, 3]]
const turboSrgbNormalized = turboSrgb.map(c => [c[0] / 255, c[1] / 255, c[2] / 255]).map(c => { const m = Math.max(Math.max(c[0], c[1]), c[2]); return [c[0] / m, c[1] / m, c[2] / m] })
const mapColor = function (v) {
  return turboSrgbNormalized[Math.floor(v * 255)]
}

export default {
  data: function () {
    return {
      opacitySliderValue: 0.3 * 255,
      colorAssignedField: this.$smt.fields.find(f => f.id === this.$smt.defaultColorAssignedFieldId) || this.$smt.fields[0].id,
      colorAssignedFieldRange: [0, 1],
      query: {
        constraints: [],
        liveConstraint: undefined
      },
      editedConstraint: undefined,
      results: {
        summary: {
          count: 0
        },
        fields: [],
        implicitConstraints: []
      },
      selectedFootprintData: []
    }
  },
  props: ['name', 'current'],
  created: function () {
    console.log('Created layer: ' + this.name)
  },
  beforeDestroy: function () {
    console.log('Destroying layer: ' + this.name)
    this.clearGeoJson()
    this.$emit('unregisterClickCb', this.onClick)
  },
  methods: {
    clearGeoJson: function () {
      if (this.geojsonObj) {
        this.$observingLayer.remove(this.geojsonObj)
        this.geojsonObj.destroy()
        this.geojsonObj = undefined
      }
      this.liveConstraint = undefined
    },
    formatDate: function (d) {
      return new Moment(d).format('YYYY-MM-DD')
    },
    printConstraint: function (c) {
      if (c.expression === undefined) return '__undefined'
      if (c.field.widget === 'date_range') return this.formatDate(c.expression[0]) + ' - ' + this.formatDate(c.expression[1])
      if (c.field.widget === 'number_range') {
        const formatVal = function (d) {
          if (c.field.formatFuncCompiled) {
            return c.field.formatFuncCompiled({ x: d })
          }
          return '' + d
        }
        return '' + formatVal(c.expression[0]) + ' - ' + formatVal(c.expression[1])
      }
      return c.expression
    },
    constraintColor: function (c) {
      if (c.field.widget === 'date_range') return undefined
      if (c.field.widget === 'number_range') return undefined
      return this.cssColorForTag(c.expression)
    },
    refreshObservationsInSky: function () {
      const that = this
      const q2 = {
        constraints: that.query.constraints
      }
      // if (that.colorAssignedField.widget === 'tags') {
      //  q2.groupingOptions = [{ operation: 'GROUP_BY', fieldId: that.colorAssignedField.id }]
      // }
      return qe.queryVisual(q2).then(res => {
        that.clearGeoJson()
        that.geojsonObj = that.$observingLayer.add('geojson-survey', {
          path: process.env.VUE_APP_SMT_SERVER + '/api/v1/hips/' + res
          // Optional:
          // max_fov: 30,
          // min_fov: 10
        })
        that.refreshGeojsonLiveFilter()
      })
    },
    refreshAllFields: function () {
      const that = this

      // Re-compute layer count
      const q1 = {
        constraints: that.query.constraints,
        groupingOptions: [{ operation: 'GROUP_ALL' }],
        aggregationOptions: [{ operation: 'COUNT', out: 'total' }]
      }
      qe.query(q1).then(res => {
        that.results.summary.count = res.res[0].total
      })

      const queryConstraintsEdited = this.query.constraints.filter(c => !this.isEdited(c))
      const constraintsIds = that.query.constraints.map(c => c.fieldId)

      // And recompute all fields
      for (const i in that.$smt.fields) {
        const field = that.$smt.fields[i]
        const edited = that.editedConstraint && that.editedConstraint.fieldId === field.id
        if (field.widget === 'tags') {
          const q = {
            constraints: edited ? queryConstraintsEdited : this.query.constraints,
            groupingOptions: [{ operation: 'GROUP_ALL' }],
            aggregationOptions: [{ operation: 'VALUES_AND_COUNT', fieldId: field.id, out: 'tags' }]
          }
          qe.query(q).then(res => {
            let tags = res.res[0].tags ? res.res[0].tags : {}
            tags = Object.keys(tags).map(function (key) {
              const closable = that.query.constraints.filter(c => c.fieldId === field.id && c.expression === key).length !== 0
              return { name: key, count: tags[key], closable: closable, color: field.id === that.colorAssignedField.id ? that.cssColorForTag(key) : undefined }
            })
            Vue.set(that.results.fields, i, {
              field: field,
              status: 'ok',
              edited: edited,
              data: tags
            })
            // Fill the implicit constraints list, i.e. the tags where only one value remains
            if (!constraintsIds.includes(field.id) && res.res[0].tags && Object.keys(res.res[0].tags).length === 1) {
              const key = Object.keys(res.res[0].tags)[0]
              that.results.implicitConstraints.push({ fieldId: field.id, field: field, expression: key, closable: false, color: field.id === that.colorAssignedField.id ? that.cssColorForTag(key) : undefined })
            }
          }, err => {
            console.log(err)
          })
        }
        if (field.widget === 'date_range') {
          const q = {
            constraints: this.query.constraints,
            groupingOptions: [{ operation: 'GROUP_ALL' }],
            aggregationOptions: [{ operation: 'DATE_HISTOGRAM', fieldId: field.id, out: 'dh' }]
          }
          qe.query(q).then(res => {
            Vue.set(that.results.fields[i], 'field', field)
            Vue.set(that.results.fields[i], 'status', 'ok')
            Vue.set(that.results.fields[i], 'edited', edited)

            // Inject color to histogram bins
            const dh = res.res[0].dh
            const dateStrToMs = function (str) {
              if (dh.step === '%Y') return Date.parse(str + '-01-01')
              if (dh.step === '%Y-%m') return Date.parse(str + '-01')
              return Date.parse(str)
            }
            if (dh.table.length) dh.table[0].push('Color')
            for (let i = 1; i < dh.table.length; i++) {
              if (that.colorAssignedField.id !== field.id) {
                dh.table[i].push('#2196f3')
                continue
              }
              let nval = (dateStrToMs(dh.table[i][0]) - that.colorAssignedFieldRange[0]) / (that.colorAssignedFieldRange[1] - that.colorAssignedFieldRange[0])
              nval = Math.min(Math.max(0, nval), 1)
              const c = mapColor(nval)
              dh.table[i].push('opacity: 0.4; color: ' + rgbToHex(Math.floor(c[0] * 255), Math.floor(c[1] * 255), Math.floor(c[2] * 255)))
            }
            Vue.set(that.results.fields[i], 'data', dh)

            // Fill the implicit constraints list, i.e. histograms where only one value remains
            if (res.res[0].dh.min === undefined && res.res[0].dh.noval > 0) {
              that.results.implicitConstraints.push({ fieldId: field.id, field: field, expression: undefined, closable: false, color: field.id === that.colorAssignedField.id ? that.cssColorForTag(undefined) : undefined })
            }
          })
        }
        if (field.widget === 'number_range') {
          const q = {
            constraints: this.query.constraints,
            groupingOptions: [{ operation: 'GROUP_ALL' }],
            aggregationOptions: [{ operation: 'NUMBER_HISTOGRAM', fieldId: field.id, out: 'dh' }]
          }
          qe.query(q).then(res => {
            Vue.set(that.results.fields[i], 'field', field)
            Vue.set(that.results.fields[i], 'status', 'ok')
            Vue.set(that.results.fields[i], 'edited', edited)

            // Inject color to histogram bins
            const dh = res.res[0].dh
            if (dh.table.length) dh.table[0].push('Color')
            for (let i = 1; i < dh.table.length; i++) {
              if (that.colorAssignedField.id !== field.id) {
                dh.table[i].push('#2196f3')
                continue
              }
              let nval = (dh.table[i][0] - that.colorAssignedFieldRange[0]) / (that.colorAssignedFieldRange[1] - that.colorAssignedFieldRange[0])
              nval = Math.min(Math.max(0, nval), 1)
              const c = mapColor(nval)
              dh.table[i].push('opacity: 0.4; color: ' + rgbToHex(Math.floor(c[0] * 255), Math.floor(c[1] * 255), Math.floor(c[2] * 255)))
            }
            Vue.set(that.results.fields[i], 'data', dh)

            // Fill the implicit constraints list, i.e. histograms where only one value remains
            if (res.res[0].dh.min === undefined && res.res[0].dh.noval > 0) {
              that.results.implicitConstraints.push({ fieldId: field.id, field: field, expression: undefined, closable: false, color: field.id === that.colorAssignedField.id ? that.cssColorForTag(undefined) : undefined })
            }
          })
        }
      }
    },
    refreshLayer: function () {
      const that = this

      if (this.$store.state.SMT.status !== 'ready') {
        return
      }

      // Clear sky
      this.clearGeoJson()
      // Reset all fields values
      that.results.fields = that.$smt.fields.map(function (e) { return { status: 'loading', data: {} } })
      that.results.implicitConstraints = []
      that.results.summary.count = undefined

      if (that.colorAssignedField.widget !== 'tags') {
        // For later steps, computing the color requires to know the min/max range first.
        const q = {
          constraints: that.query.constraints,
          groupingOptions: [{ operation: 'GROUP_ALL' }],
          aggregationOptions: [{ operation: 'MIN_MAX', fieldId: that.colorAssignedField.id, out: 'minmax' }]
        }
        qe.query(q).then(res => {
          that.colorAssignedFieldRange = res.res[0].minmax
          // Recompute all fields & sky content
          that.refreshObservationsInSky()
          that.refreshAllFields()
        })
        return
      }

      // Recompute all fields & sky content
      that.refreshObservationsInSky()
      that.refreshAllFields()
    },
    cssColorForTag: function (val) {
      const c = mapColor(stringHash(val) / 4294967295)
      c[3] = 0.4
      return 'rgba(' + c[0] * 255 + ',  ' + c[1] * 255 + ',  ' + c[2] * 255 + ',  ' + c[3] + ')'
    },
    colorForFeature: function (feature) {
      if (this.colorAssignedField.widget === 'tags') {
        const keysAndCount = _.get(feature.properties, this.colorAssignedField.id)
        const val = Object.keys(keysAndCount)
        if (!val || !val.length) return [0.5, 0.5, 0.5, this.opacity]
        const c = [0, 0, 0, this.opacity]
        let total = 0
        val.forEach(v => {
          const cc = mapColor(stringHash(v || '') / 4294967295)
          c[0] += cc[0] * keysAndCount[v]
          c[1] += cc[1] * keysAndCount[v]
          c[2] += cc[2] * keysAndCount[v]
          total += keysAndCount[v]
        })
        c[0] /= total
        c[1] /= total
        c[2] /= total
        return c
      } else {
        const val = _.get(feature.properties, this.colorAssignedField.id)
        if (!val || val.length < 2) return [0.5, 0.5, 0.5, this.opacity]
        let nval = (val[0] + val[1]) / 2
        nval = (nval - this.colorAssignedFieldRange[0]) / (this.colorAssignedFieldRange[1] - this.colorAssignedFieldRange[0])
        const c = mapColor(nval)
        c[3] = this.opacity
        return c
      }
    },
    refreshGeojsonLiveFilter: function () {
      const that = this
      if (!that.geojsonObj) return
      const selectedGeogroupIds = new Set(that.selectedFootprintData.map(e => e.geogroup_id))

      let liveConstraintSql
      const lc = that.liveConstraint
      if (lc) {
        const lcField = that.$smt.fields.find(f => f.id === lc.fieldId)
        if (lcField.widget === 'date_range' && lc.operation === 'DATE_RANGE') {
          liveConstraintSql = lc.fieldId
        }
        if (lcField.widget === 'number_range' && lc.operation === 'NUMBER_RANGE') {
          liveConstraintSql = lc.fieldId
        }
      }
      that.geojsonObj.filter = function (feature) {
        if (liveConstraintSql) {
          const v = _.get(feature.properties, liveConstraintSql)
          if (!v || v[1] < lc.expression[0] || v[0] > lc.expression[1]) {
            return { hidden: true }
          }
        }
        const selected = selectedGeogroupIds.has(feature.geogroup_id)
        if (selected !== feature.selected) {
          feature.selected = selected
          feature.colorDone = false
        }
        if (feature.colorDone && feature.opacity === that.opacity) return { hidden: false }
        const c = that.colorForFeature(feature)
        feature.colorDone = true
        feature.opacity = that.opacity
        return {
          fill: c,
          stroke: [1, 0, 0, 0],
          hidden: false,
          blink: feature.selected
        }
      }
    },
    addConstraint: function (c) {
      const that = this
      this.query.constraints = this.query.constraints.filter(cons => {
        const consField = that.$smt.fields.find(f => f.id === cons.fieldId)
        if (consField.widget === 'date_range' && cons.fieldId === c.fieldId) return false
        if (consField.widget === 'number_range' && cons.fieldId === c.fieldId) return false
        return true
      })
      this.query.constraints.push(c)
      this.editedConstraint = c
      this.refreshLayer()
    },
    removeConstraint: function (c) {
      this.query.constraints = this.query.constraints.filter(cons => {
        if (cons.fieldId === c.fieldId && cons.expression === c.expression && cons.operation === c.operation) return false
        return true
      })
      this.refreshLayer()
    },
    constraintLiveChanged: function (c) {
      this.liveConstraint = c
      this.refreshGeojsonLiveFilter()
    },
    constraintClicked: function (i) {
      this.editedConstraint = this.query.constraints[i]
      this.refreshLayer()
    },
    constraintClosed: function (i) {
      this.query.constraints.splice(i, 1)
      this.refreshLayer()
    },
    isEdited: function (c) {
      return this.editedConstraint && c.fieldId === this.editedConstraint.fieldId
    },
    unselect: function () {
      this.selectedFootprintData = []
    },
    onClick: function (e) {
      if (!this.current) return false
      if (!this.geojsonObj) return false
      // Get the list of features indices at click position
      const r = this.geojsonObj.queryRenderedFeatures(e.point)
      let someFeatureHaveNoGeogroupId = false
      r.forEach(f => { someFeatureHaveNoGeogroupId ||= (f.geogroup_id === undefined) })
      if (r.length && r[0].geogroup_id && !someFeatureHaveNoGeogroupId) {
        this.selectedFootprintData = r
      } else {
        this.selectedFootprintData = []
        return false
      }
      return true
    }
  },
  watch: {
    '$store.state.SMT.status': function () {
      this.refreshLayer()
    },
    selectedFootprintData: function () {
      // refresh the geojson live filter to make the selected object blink
      this.refreshGeojsonLiveFilter()
    },
    opacity: function () {
      this.refreshGeojsonLiveFilter()
    },
    colorAssignedField: function () {
      this.refreshLayer()
    },
    current: function () {
      if (!this.current) this.unselect()
    }
  },
  computed: {
    opacity: function () {
      return this.opacitySliderValue / 255
    },
    allColorFields: function () {
      return this.$smt ? this.$smt.fields.map(f => f.id) : []
    },
    // Return real and implicit constraints to display in GUI
    constraintsToDisplay: function () {
      if (this.$store.state.SMT.status !== 'ready') {
        return []
      }

      let res = _.cloneDeep(this.query.constraints)
      for (const i in res) {
        res[i].closable = true
        res[i].field = this.$smt.fields.find(f => f.id === res[i].fieldId)
        res[i].color = (res[i].field.id === this.colorAssignedField.id) ? this.constraintColor(res[i]) : undefined
      }
      // Add implicit constraints (when only a unique tag value match the query)
      res = res.concat(this.results.implicitConstraints)
      return res
    },
    // Return fields with relevant information to display in GUI
    resultsFieldsToDisplay: function () {
      if (this.$store.state.SMT.status !== 'ready') {
        return []
      }
      const res = []
      for (const i in this.results.fields) {
        const rf = this.results.fields[i]
        if (!rf.field) continue
        if (this.isEdited(rf)) {
          if (rf.field.widget === 'date_range' && rf.data && (rf.data.max === undefined || rf.data.min === undefined)) continue
          res.push(rf)
          continue
        }
        // Don't display tags widget when only one value remains (already displayed as implicit constraints)
        if (rf.field.widget === 'tags' && rf.data) {
          const setVals = rf.data.filter(tag => tag.closable === true).length
          const unsetVals = rf.data.filter(tag => tag.closable === false).length
          if (!setVals && unsetVals <= 1) continue
          if (setVals && unsetVals === 0) continue
        }
        // Don't display date range if the range is <= 24h
        if (rf.field.widget === 'date_range' && rf.data) {
          if (rf.data.max === undefined || rf.data.min === undefined) continue
          const dt = rf.data.max - rf.data.min
          if (dt <= 1000 * 60 * 60 * 24) continue
        }
        if (rf.field.widget === 'number_range' && rf.data) {
          if (rf.data.max === rf.data.min) continue
        }
        res.push(rf)
      }
      return res
    }
  },
  mounted: function () {
    this.refreshLayer()
    this.$emit('registerClickCb', this.onClick)
  },
  components: { SmtField, SmtSelectionInfo }
}
</script>

<style>
.scroll-container {
  flex: 1 1 auto;
  overflow-y: scroll;
  backface-visibility: hidden;
}
ul {
  padding-left: 30px;
}
/* scroll bar style */
::-webkit-scrollbar {
  width: 10px;
}
/* Track */
::-webkit-scrollbar-track {
  background: #121212;
}
/* Handle */
::-webkit-scrollbar-thumb {
  background: #424242;
}
/* Handle on hover */
::-webkit-scrollbar-thumb:hover {
  background: #555;
}
</style>
