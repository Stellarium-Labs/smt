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
      <GChart type="AreaChart" :data="histoData.table" :options="chartOptions" />
    </v-col>
  </v-row>
</template>

<script>
import _ from 'lodash'
import { GChart } from 'vue-google-charts'

export default {
  data: function () {
    return {
    }
  },
  props: ['data'],
  methods: {
  },
  computed: {
    histoData: function () {
      if (this.data) {
        const newData = _.cloneDeep(this.data)
        if (newData.table.length) {
          newData.table[0].push({ role: 'annotation' })
        }
        for (let i = 1; i < newData.table.length; ++i) {
          newData.table[i][0] = new Date(newData.table[i][0])
          newData.table[i].push('' + newData.table[i][1])
        }
        return newData
      }
      return {}
    },
    chartOptions: function () {
      return {
        title: this.data ? this.data.field.id : '',
        titleTextStyle: { color: 'white' },
        chartArea: { left: '5%', width: '80%' },
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
        isStacked: true
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
