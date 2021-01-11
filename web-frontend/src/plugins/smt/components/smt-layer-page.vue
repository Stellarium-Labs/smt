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
  <div style="height: 100%; display: flex; flex-flow: column;">
    <img :src="watermarkImage" style="position: fixed; left: 5px; bottom: 5px; opacity: 0.7;"></img>
    <smt-selection-info :selectedFeatures="selectedFootprintData" :query="query" @unselect="unselect()"></smt-selection-info>
    <smt-panel-root-toolbar></smt-panel-root-toolbar>
    <v-chip-group v-model="tab" center-active mandatory large active-class="primary--text" style="margin-left: 5px; height: 48px;">
      <v-chip v-for="name in layersList" :key="name" close close-icon="mdi-close" label @click:close="delLayer(name)">{{ name }}</v-chip>
      <v-btn icon class="transparent" @click.stop="addLayer()" style="margin-left: 0px; margin-top: 3px;"><v-icon>mdi-plus</v-icon></v-btn>
    </v-chip-group>
    <v-tabs-items v-model="tab" style="height: 100%;">
      <v-tab-item :eager="true" v-for="name in layersList" :key="name" style="height: 100%; display: flex; flex-flow: column;">
        <smt-layer :name="name"></smt-layer>
      </v-tab-item>
    </v-tabs-items>
    </v-card>
  </div>
</template>

<script>
import SmtPanelRootToolbar from './smt-panel-root-toolbar.vue'
import SmtSelectionInfo from './smt-selection-info.vue'
import SmtLayer from './smt-layer.vue'

export default {
  data: function () {
    return {
      tab: null,
      layersList: [],
      layerNameIdx: 2,
      query: {}, // Remove me
      selectedFootprintData: [] // Remove me
    }
  },
  created: function () {
    this.addLayer('Layer 1')
  },
  methods: {
    addLayer: function (name) {
      if (!name) {
        do {
          name = 'Layer ' + this.layerNameIdx
          this.layerNameIdx++
        } while (this.layersList.indexOf(name) !== -1)
      }
      this.layersList.push(name)
      this.tab = this.layersList.length - 1
    },
    delLayer: function (name) {
      const index = this.layersList.indexOf(name)
      if (index !== -1) {
        this.layersList.splice(index, 1)
      }
    }
  },
  watch: {
    '$store.state.SMT.status': function () {
      // this.refreshObservationGroups()
    }
  },
  computed: {
    watermarkImage: function () {
      if (this.$store.state.SMT.watermarkImage) return process.env.BASE_URL + 'plugins/smt/data/' + this.$store.state.SMT.watermarkImage
      return ''
    }
  },
  mounted: function () {
  },
  components: { SmtPanelRootToolbar, SmtSelectionInfo, SmtLayer }
}
</script>

<style>
</style>
