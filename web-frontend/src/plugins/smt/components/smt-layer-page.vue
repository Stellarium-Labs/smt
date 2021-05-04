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
      <v-btn icon class="transparent" @click.stop="addLayer()" style="margin-left: 0px; margin-top: 0px;"><v-icon>mdi-plus</v-icon></v-btn>
      <v-spacer></v-spacer>
      <v-menu close-on-click>
        <template v-slot:activator="{ on, attrs }">
          <v-btn icon class="transparent" dark v-bind="attrs" v-on="on" style="margin-left: 0px; margin-top: 0px;"><v-icon>mdi-dots-vertical</v-icon></v-btn>
        </template>
        <v-list>
          <v-list-item :disabled="layersList.length === 0" @click="renameLayer">
            <v-list-item-title>Rename current layer</v-list-item-title>
          </v-list-item>
          <v-list-item :disabled="layersList.length === 0" @click="saveAllLayers">
            <v-list-item-title>Save all layers</v-list-item-title>
          </v-list-item>
          <v-list-item>
            <label class="file-select">
              <v-list-item-title>Load layers..</v-list-item-title>
              <input type="file" @change="loadLayers"/>
            </label>
          </v-list-item>
        </v-list>
      </v-menu>

    </v-chip-group>
    <div style="height: calc(100% - 38px - 48px);">
      <v-tabs-items v-model="tab" style="height: 100%;  overflow: visible;">
        <v-tab-item :eager="true" v-for="(layer, index) in layersList" :key="layer.id" style="height: 100%; display: flex; flex-flow: column;">
          <smt-layer :name="layer.name" :z="index" :constraints="layer.constraints" @update:constraints="updateLayerConstraints(index, $event)" :current="index === tab" v-on:registerClickCb="onRegisterClickCb" v-on:unregisterClickCb="onUnregisterClickCb"></smt-layer>
        </v-tab-item>
      </v-tabs-items>
    </div>
  </div>
</template>

<script>
import SmtPanelRootToolbar from './smt-panel-root-toolbar.vue'
import SmtLayer from './smt-layer.vue'
import draggable from 'vuedraggable'
import _ from 'lodash'
import download from 'downloadjs'
import qe from '../query-engine'
import Vue from 'vue'

export default {
  data: function () {
    return {
      tab: null,
      layersList: [],
      layerNameIdx: 2
    }
  },
  methods: {
    updateLayerConstraints: function (index, newConstraints) {
      this.layersList[index].constraints = _.cloneDeep(newConstraints)
    },
    renameLayer: async function () {
      const res = await this.$dialog.prompt({
        text: 'New name',
        title: 'Rename layer'
      })
      this.layersList[this.tab].name = res
    },
    saveAllLayers: function () {
      download(JSON.stringify(this.layersList, null, 2), 'layers.json', 'application/json')
    },
    loadLayers: function (e) {
      const that = this
      const files = e.target.files || e.dataTransfer.files
      if (!files.length) return
      const reader = new FileReader()
      reader.onload = (e) => {
        const newLayer = JSON.parse(e.target.result)
        that.layersList = newLayer
      }
      reader.readAsText(files[0])
    },
    addLayer: function (name) {
      if (!name) {
        do {
          name = 'Layer ' + this.layerNameIdx
          this.layerNameIdx++
        } while (this.layersList.find(l => l.name === name) !== undefined)
      }
      this.layersList.push({ id: this.layerNameIdx, name: name, constraints: [] })
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
        if (this.layersList.length === 0) {
          this.addLayer('Layer 1')
        }
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

    const that = this
    const statusChangedCb = function (status) {
      if (status === 'ready') {
        Vue.prototype.$smt = qe.smtConfig
        that.$store.commit('setValue', { varName: 'SMT.smtServerInfo', newValue: qe.smtServerInfo })
        if (qe.smtConfig.watermarkImage) {
          that.$store.commit('setValue', { varName: 'SMT.watermarkImage', newValue: qe.smtConfig.watermarkImage })
        }
      }
      that.$store.commit('setValue', { varName: 'SMT.status', newValue: status })
    }
    qe.init(that.$route.params.branch, statusChangedCb)
  },
  mounted: function () {
    // Manage geojson features selection
    this.$stel.on('click', e => {
      for (let i = 0; i < this.clickCallbacks.length; i++) {
        if (this.clickCallbacks[i](e)) return true
      }
      return false
    })
    this.$stel.on('rectSelection', e => {
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
.file-select > input[type="file"] {
  display: none;
}
</style>
