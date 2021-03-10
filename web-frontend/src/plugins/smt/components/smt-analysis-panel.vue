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
  <div style="height: 100%; width: 100%; background-color: #212121;">
    <v-toolbar dense class="obspanel-toolbar">
      <v-btn icon class="transparent" @click.stop=""><v-icon>mdi-close</v-icon></v-btn>
      <v-spacer></v-spacer>
      <span class="px-2 grey--text">Analysis of {{ name }}</span>
      <v-spacer></v-spacer>
    </v-toolbar>
    <div class="scroll-container" style="height: calc(100% - 48px)">
      <v-container class="pt-0">
        <smt-histogram class="mb-2" v-for="fr in results.fields" :key="fr.field.id" :data='fr'>{{ fr.table }}</smt-histogram>
      </v-container>
    </div>
  </div>
</template>

<script>
import qe from '../query-engine'
import SmtHistogram from './smt-histogram.vue'
// import Vue from 'vue'

export default {
  data: function () {
    return {
      results: {
        summary: {
          count: 0,
          area: 0
        },
        fields: []
      }
    }
  },
  props: ['name', 'constraints', 'referenceFieldId'],
  watch: {
    constraints: function () {
      // console.log(this.constraints)
      this.refreshAllFields()
    }
  },
  methods: {
    refreshMinMax: function () {
      // Compute min/max for the field used to split the horizontal axis
      const q = {
        constraints: this.constraints,
        groupingOptions: [{ operation: 'GROUP_ALL' }],
        aggregationOptions: [{ operation: 'MIN_MAX', fieldId: this.referenceFieldId, out: 'minmax' }]
      }
      return qe.query(q).then(res => {
        return res.res[0].minmax
      })
    },

    refreshAllFields: function () {
      const that = this
      that.refreshMinMax().then(function (minmax) {
        that.results.fields = []
        if (minmax[0] === minmax[1]) {
          return
        }

        const minSteps = 10
        const start = new Date(minmax[0])
        start.setUTCHours(0, 0, 0, 0)
        // Switch to next day and truncate
        const stop = new Date(minmax[1] + 1000 * 60 * 60 * 24)
        stop.setUTCHours(23, 59, 59, 0)
        // Range in days
        const range = (stop - start) / (1000 * 60 * 60 * 24)
        let step = 'day'
        if (range > minSteps * 365) {
          step = 'year'
        } else if (range > minSteps * 30) {
          step = 'month'
        }

        const q = {
          constraints: that.constraints,
          groupingOptions: [{ operation: 'GROUP_BY_DATE', fieldId: that.referenceFieldId, step: step }],
          aggregationOptions: [
            { operation: 'COUNT', out: 'count' },
            { operation: 'MIN', fieldId: that.referenceFieldId, out: 'x' }
          ]
        }
        for (const i in that.$smt.fields) {
          const field = that.$smt.fields[i]
          if (field.widget === 'tags') {
            q.aggregationOptions.push({ operation: 'VALUES_AND_COUNT', fieldId: field.id, out: field.id })
          }
        }
        qe.query(q).then(res => {
          const lines = res.res.filter(l => !!l.x)
          that.results.fields.push({
            field: { id: 'count' },
            table: [['Date', 'Count']].concat(lines.map(l => [l.x, l.count]))
          })
          for (const i in that.$smt.fields) {
            const field = that.$smt.fields[i]
            if (field.widget === 'tags') {
              let allValues = []
              lines.map(l => { allValues = allValues.concat(Object.keys(l[field.id])) })
              allValues = Array.from(new Set(allValues))
              const vals = lines.map(l => [l.x].concat(allValues.map(k => l[field.id][k])))
              that.results.fields.push({
                field: { id: field.id },
                table: [['Date'].concat(allValues)].concat(vals)
              })
            }
          }
        }, err => {
          console.log(err)
        })
      })
    }
  },
  computed: {
  },
  created: function () {
  },
  mounted: function () {
    this.refreshAllFields()
  },
  components: { SmtHistogram }
}
</script>

<style>
.scroll-container {
  flex: 1 1 auto;
  overflow-y: scroll;
  backface-visibility: hidden;
}
</style>
