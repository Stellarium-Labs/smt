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

<v-toolbar dense class="obspanel-toolbar">
  <span class="px-2 grey--text">SMT - <a href="https://github.com/Stellarium-Labs/smt/blob/survey-monitoring-tool/smt-server/CHANGELOG.md" target="_blank">{{ $store.state.SMT.smtServerInfo.version }}</a></span>
  <v-spacer></v-spacer>
  <v-dialog v-model="dialog" max-width="600">
    <v-card>
      <v-card-title class="text-h5">SMT Server Info</v-card-title>
      <v-card-text>
        SMT Server version: <b>{{ $store.state.SMT.smtServerInfo.version }}</b><br>
        Displaying data coming from server: <b>{{ $store.state.SMT.smtServerInfo.dataGitServer }}</b><br>
        Git Branch: <b>{{ $store.state.SMT.smtServerInfo.dataGitBranch }}</b><br>
        Last ref: <b>{{ $store.state.SMT.smtServerInfo.dataGitSha1 }}</b><br>
        Local Modifications: <b>{{ $store.state.SMT.smtServerInfo.dataLocalModifications }}</b><br>
        Last ingestion logs: <v-btn icon class="transparent" @click="dialog = false; logsDialog = true"><v-icon>mdi-text</v-icon></v-btn>
      </v-card-text>
      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn color="green darken-1" text @click="dialog = false">OK</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
  <v-dialog v-model="logsDialog" max-width="1000">
    <v-card>
      <v-card-title class="text-h5">SMT Ingestion Logs</v-card-title>
      <v-card-text>
        <ul id="logs">
          <li v-for="(item, index) in $store.state.SMT.smtServerInfo.ingestionLogs" :key="index">
            <span v-html="cleanupLogEntry(item)"></span>
          </li>
        </ul>
      </v-card-text>
      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn color="green darken-1" text @click="logsDialog = false">OK</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
  <v-spacer></v-spacer>
  <v-progress-circular v-if="$store.state.SMT.status !== 'ready'" size=18 indeterminate></v-progress-circular>
  <span class="px-2">Server {{ $store.state.SMT.status }}</span>
  <v-btn icon class="transparent" @click.stop="dialog = true"><v-icon>mdi-information-outline</v-icon></v-btn>
</v-toolbar>

</template>

<script>

export default {
  data: function () {
    return {
      dialog: false,
      logsDialog: false
    }
  },
  methods: {
    cleanupLogEntry: function (s) {
      return s.replace(/(?:\r\n|\r|\n)/g, '<br>')
    }
  },
  computed: {
  }
}
</script>

<style>
.obspanel-toolbar {
  background-color: #212121!important;
  flex: 0 1 auto;
}
</style>
