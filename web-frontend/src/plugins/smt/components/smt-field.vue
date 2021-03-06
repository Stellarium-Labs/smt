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
  <v-row no-gutters style="position: relative">
    <div :class="{rowedited: fieldResults.edited}"></div>
    <v-col cols="12">
      <h3 class="pt-3 line_right">{{ fieldDescription.name }}
        <v-tooltip v-if="fieldDescription.description" top max-width="300" color="#000000">
          <template v-slot:activator="{ on, attrs }">
            <v-icon class="pl-2 mb-1" color="#444444" small dark v-bind="attrs" v-on="on">mdi-help-circle-outline</v-icon>
          </template>
          <div v-html="fieldDescription.description_html"></div>
        </v-tooltip>
      </h3>
    </v-col>
    <smt-field-chips v-if="isTags" :fieldResults="fieldResults" v-on:add-constraint="addConstraint" v-on:remove-constraint="removeConstraint"></smt-field-chips>
    <smt-field-date-range v-if="isDateRange" :fieldResults="fieldResults" v-on:add-constraint="addConstraint" v-on:constraint-live-changed="constraintLiveChanged"></smt-field-date-range>
    <smt-field-number-range v-if="isNumberRange" :fieldResults="fieldResults" v-on:add-constraint="addConstraint" v-on:constraint-live-changed="constraintLiveChanged"></smt-field-number-range>
  </v-row>
</template>

<script>
import SmtFieldChips from './smt-field-chips.vue'
import SmtFieldDateRange from './smt-field-date-range.vue'
import SmtFieldNumberRange from './smt-field-number-range.vue'

export default {
  data: function () {
    return {
    }
  },
  props: ['fieldDescription', 'fieldResults'],
  methods: {
    addConstraint: function (c) {
      this.$emit('add-constraint', c)
    },
    removeConstraint: function (c) {
      this.$emit('remove-constraint', c)
    },
    constraintLiveChanged: function (c) {
      this.$emit('constraint-live-changed', c)
    }
  },
  computed: {
    isTags: function () {
      return this.fieldDescription && this.fieldDescription.widget === 'tags' && this.fieldResults
    },
    isDateRange: function () {
      return this.fieldDescription && this.fieldDescription.widget === 'date_range' && this.fieldResults
    },
    isNumberRange: function () {
      return this.fieldDescription && this.fieldDescription.widget === 'number_range' && this.fieldResults
    }
  },
  components: { SmtFieldChips, SmtFieldDateRange, SmtFieldNumberRange }
}
</script>

<style>
.line_right {
  overflow: hidden;
}

.line_right:after {
  background-color: #444;
  content: "";
  display: inline-block;
  height: 1px;
  position: relative;
  vertical-align: middle;
  width: 100%;
  left: 20px;
  margin-right: -100%;
}

.rowedited {
  border-width: 3px;
  border-style: solid;
  border-radius: 12px;
  border-color: #2196f3 !important;
  width: calc(100% + 16px);
  height:  calc(100% + 10px);
  position: absolute;
  z-index: 1;
  margin-left: -8px;
  margin-top: 2px;
  pointer-events: none;
}
</style>
