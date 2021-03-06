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
  <v-col cols="12">
    <v-row no-gutters>
      <v-col cols="12">
        <GChart type="ColumnChart" :data="fieldResultsData.table" :options="dateRangeChartOptions" style="margin-bottom: -10px; height: 120px"/>
      </v-col>
      <v-col cols="12">
        <v-range-slider hide-details class="px-3 my-0" v-model="dateRangeSliderValues" :min="dateRange[0]" :max="dateRange[1]" v-on:start="isUserDragging = true" v-on:end="isUserDragging = false"></v-range-slider>
      </v-col>
      <v-col cols="4">
        <v-text-field dense solo v-mask="dateMask" :rules="[rules.required, rules.date]" :value="formatDate(dateRangeSliderValues[0])" @change="rangeMinTextuallyChanged"></v-text-field>
      </v-col>
      <v-col cols="1"></v-col>
      <v-col cols="4">
        <v-text-field dense solo v-mask="dateMask" :rules="[rules.required, rules.date]" :value="formatDate(dateRangeSliderValues[1])" @change="rangeMaxTextuallyChanged"></v-text-field>
      </v-col>
      <v-col cols="1"></v-col>
      <v-col cols="2" style="margin-top: -10px">
        <v-btn small fab :disabled="!wasChanged" @click="rangeButtonClicked">Add</v-btn>
      </v-col>
    </v-row>
    <v-btn style="position: absolute; right: 5px; top: 25px;" v-if="wasChanged" small fab @click="cancelButtonClicked"><v-icon>mdi-close</v-icon></v-btn>
  </v-col>
</template>

<script>
import _ from 'lodash'
import { GChart } from 'vue-google-charts'
import Moment from 'moment'
import { mask } from 'vue-the-mask'

export default {
  data: function () {
    return {
      isUserDragging: false,
      wasChanged: false,
      dateMask: '####-##-##',
      dateRangeSliderValues: [0, 1],
      dateRangeChartOptions: {
        legend: { position: 'none' },
        backgroundColor: '#212121',
        annotations: {
          highContrast: false,
          textStyle: {
            color: '#ffffff'
          }
        },
        chartArea: { left: '5%', top: '5%', width: '90%', height: '65%' },
        hAxis: {
          textStyle: {
            color: 'white'
          },
          gridlines: {
            color: 'transparent'
          }
        },
        vAxis: {
          textStyle: {
            color: 'transparent'
          },
          gridlines: {
            count: 0
          }
        }
      },
      rules: {
        required: value => !!value || 'Required.',
        date: value => {
          if (isNaN(new Date(value))) return 'Invalid date'
          return true
        }
      }
    }
  },
  directives: { mask },
  props: ['fieldResults'],
  methods: {
    formatDate: function (d) {
      return new Moment(d).format('YYYY-MM-DD')
    },
    rangeButtonClicked: function () {
      const constraint = {
        fieldId: this.fieldResults.field.id,
        operation: 'DATE_RANGE',
        expression: [this.dateRangeSliderValues[0], this.dateRangeSliderValues[1]],
        negate: false
      }
      this.$emit('add-constraint', constraint)
      this.wasChanged = false
    },
    cancelButtonClicked: function () {
      this.$emit('constraint-live-changed', undefined)
      this.dateRangeSliderValues = this.dateRange
      this.wasChanged = false
    },
    rangeMinTextuallyChanged: function (v) {
      if (this.rules.date(v) === true) {
        const t = new Date(v).getTime()
        this.dateRangeSliderValues = [t, this.dateRangeSliderValues[1]]
        this.wasChanged = true
      }
    },
    rangeMaxTextuallyChanged: function (v) {
      if (this.rules.date(v) === true) {
        const t = new Date(v).getTime()
        this.dateRangeSliderValues = [this.dateRangeSliderValues[0], t]
        this.wasChanged = true
      }
    }
  },
  computed: {
    fieldResultsData: function () {
      if (this.fieldResults) {
        const newData = _.cloneDeep(this.fieldResults.data)
        if (newData.table.length) {
          newData.table[0].push({ role: 'annotation' })
          newData.table[0][2] = { role: 'style' }
        }
        for (let i = 1; i < newData.table.length; ++i) {
          newData.table[i].push('' + newData.table[i][1])
        }
        return newData
      }
      return {}
    },
    dateRange: function () {
      if (this.fieldResults && this.fieldResults.data && this.fieldResults.data.min !== undefined) {
        return [Date.parse(this.fieldResults.data.min), Date.parse(this.fieldResults.data.max)]
      }
      return [0, 1]
    }
  },
  mounted: function () {
    this.dateRangeSliderValues = this.dateRange
    this.wasChanged = false
  },
  watch: {
    dateRangeSliderValues: function (s) {
      const constraint = {
        fieldId: this.fieldResults.field.id,
        operation: 'DATE_RANGE',
        expression: [this.dateRangeSliderValues[0], this.dateRangeSliderValues[1]],
        negate: false
      }
      if (this.isUserDragging) {
        this.$emit('constraint-live-changed', constraint)
        this.wasChanged = true
      }
    }
  },
  components: { GChart }
}
</script>

<style>
.v-input__slot {
  min-height: 10px;
}
/* Work-around google chart tooltip blinking
 See https://stackoverflow.com/questions/37902708/google-charts-tooltip-flickering */
svg > g > g:last-child {
  pointer-events: none
}
</style>
