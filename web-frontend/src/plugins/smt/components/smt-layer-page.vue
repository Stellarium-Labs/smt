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
  <div style="height: 100%;">
    <img :src="watermarkImage" style="position: fixed; left: 5px; bottom: 5px; opacity: 0.4;"></img>
    <smt-panel-root-toolbar></smt-panel-root-toolbar>
    <v-chip-group v-model="tab" center-active mandatory show-arrows active-class="chip-tab-active" style="margin-left: 5px; height: 38px;">
      <draggable v-model="layersList">
        <v-chip v-for="layer in layersList" :key="layer.id" color="#262626" close draggable close-icon="mdi-close" class="chip-tab-inactive" label @click:close="delLayer(layer.id)">{{ layer.name }}</v-chip>
      </draggable>
      <v-btn icon class="transparent" @click.stop="addLayer()" style="margin-left: 0px; margin-top: 3px;"><v-icon>mdi-plus</v-icon></v-btn>
    </v-chip-group>
    <div style="height: calc(100% - 38px - 48px);">
      <v-tabs-items v-model="tab" style="height: 100%;">
        <v-tab-item :eager="true" v-for="(layer, index) in layersList" :key="layer.id" style="height: 100%; display: flex; flex-flow: column;">
          <smt-layer :name="layer.name" :z="index" :current="index === tab" v-on:registerClickCb="onRegisterClickCb" v-on:unregisterClickCb="onUnregisterClickCb"></smt-layer>
        </v-tab-item>
      </v-tabs-items>
    </div>
    </v-card>
  </div>
</template>

<script>
import SmtPanelRootToolbar from './smt-panel-root-toolbar.vue'
import SmtLayer from './smt-layer.vue'
import draggable from 'vuedraggable'

export default {
  data: function () {
    return {
      tab: null,
      layersList: [],
      layerNameIdx: 2
    }
  },
  methods: {
    addLayer: function (name) {
      if (!name) {
        do {
          name = 'Layer ' + this.layerNameIdx
          this.layerNameIdx++
        } while (this.layersList.find(l => l.name === name) !== undefined)
      }
      this.layersList.push({ id: this.layerNameIdx, name: name })
      this.tab = this.layersList.length - 1
    },
    delLayer: function (id) {
      const index = this.layersList.findIndex(l => l.id === id)
      if (index !== -1) {
        this.layersList.splice(index, 1)
      }
    },
    onRegisterClickCb: function (cb) {
      this.clickCallbacks.push(cb)
    },
    onUnregisterClickCb: function (cb) {
      this.clickCallbacks = this.clickCallbacks.filter(item => item !== cb)
    }
  },
  watch: {
    '$store.state.SMT.status': function () {
      if (this.$store.state.SMT.status === 'ready') {
        this.addLayer('Layer 1')
      }
    }
  },
  computed: {
    watermarkImage: function () {
      if (this.$store.state.SMT.watermarkImage) return process.env.BASE_URL + 'plugins/smt/data/' + this.$store.state.SMT.watermarkImage
      return ''
    }
  },
  created: function () {
    this.clickCallbacks = []
  },
  mounted: function () {
    // Manage geojson features selection
    this.$stel.on('click', e => {
      for (let i = 0; i < this.clickCallbacks.length; i++) {
        if (this.clickCallbacks[i](e)) return true
      }
      return false
    })
  },
  components: { SmtPanelRootToolbar, SmtLayer, draggable }
}
</script>

<style>
.chip-tab-active {
  background-color: #424242 !important;
}
.v-chip:before {
  background-color: #424242 !important;
}
.chip-tab-inactive {
  background-color: #262626;
  border-radius: 2px !important;
}
</style>
