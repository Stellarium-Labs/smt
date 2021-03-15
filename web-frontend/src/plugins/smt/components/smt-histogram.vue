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
  <v-row>
    <v-col cols="12">
      <h3 class="pt-5">{{ data.field.name }}
        <v-tooltip v-if="data.field.description" top max-width="300" color="#000000">
          <template v-slot:activator="{ on, attrs }">
            <v-icon class="pl-2 mb-1" color="#444444" small dark v-bind="attrs" v-on="on">mdi-help-circle-outline</v-icon>
          </template>
          <div v-html="data.field.description_html"></div>
        </v-tooltip>
      </h3>
    </v-col>
    <v-col cols="12">
      <div v-if="loading" style="height: 250px;">
        <v-progress-circular size=30 indeterminate style="margin-left: calc(50% - 25px); margin-top: 110px; z-index: 1000;"></v-progress-circular>
      </div>
      <GChart v-else type="AreaChart" :data="histoData.table" :options="chartOptions" style="height: 250px;"/>
    </v-col>
  </v-row>
</template>

<script>
import _ from 'lodash'
import { GChart } from 'vue-google-charts'
import Moment from 'moment'

export default {
  data: function () {
    return {
    }
  },
  props: ['data', 'cumulative', 'showItemsWithoutDate'],
  methods: {
    formatDate: function (d, step) {
      if (step === 'day') return new Moment(d).format('YYYY-MM-DD')
      if (step === 'month') return new Moment(d).format('YYYY-MM')
      if (step === 'year') return new Moment(d).format('YYYY')
      console.log('Unknown date step: ' + step)
    }
  },
  computed: {
    loading: function () {
      if (this.data) {
        return !!this.data.loading
      }
      return true
    },
    histoData: function () {
      if (this.data) {
        const newData = _.cloneDeep(this.data)
        if (!this.showItemsWithoutDate) {
          newData.table = newData.table.filter(l => l[0] !== null)
        }

        newData.table[0] = newData.table[0].map(s => s === '__undefined' ? 'Undefined' : s)
        // Compute cumulative values
        if (this.cumulative) {
          let acc
          for (let i = 1; i < newData.table.length; ++i) {
            if (acc) {
              for (let j = 1; j < acc.length; ++j) {
                acc[j] += newData.table[i][j] || 0
              }
            } else {
              acc = _.cloneDeep(newData.table[i]).map(e => e || 0)
            }
            acc[0] = newData.table[i][0]
            newData.table[i] = _.cloneDeep(acc)
          }
        }
        return newData
      }
      return {}
    },
    chartOptions: function () {
      return {
        chartArea: { left: '60', height: '85%', right: '150' },
        backgroundColor: '#212121',
        legend: { textStyle: { color: '#b2b2b2' } },
        hAxis: {
          textStyle: { color: 'white' },
          gridlines: { color: '#333' }
        },
        vAxis: {
          minValue: 0,
          textStyle: { color: '#b2b2b2' },
          gridlines: { color: '#333' }
        },
        isStacked: true,
        focusTarget: 'category'
      }
    }
  },
  mounted: function () {
  },
  watch: {
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
