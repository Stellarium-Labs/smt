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
    <v-chip small class="white--text ma-1" :close="tag.closable" :style="tag.closable ? 'border: 2px solid #2196f3;' : ''" :color="tag.color ? tag.color : (tag.closable ? 'primary' : 'secondary')" v-for="(tag, i) in fieldResultsData" :key="i" @click="chipClicked(tag.name)" @click:close="chipClosed(tag.name)">
      <span v-if="tag.name === '__undefined'"><i>Undefined</i></span><span v-else>{{ tag.name }}</span>&nbsp;<span :class="tag.closable ? 'white--text' : 'primary--text'"> ({{ tag.count }})</span>
    </v-chip>
    <v-text-field class="mt-2 mb-n6" v-if="showFreeTextSearch" filled dense rounded label="Add comma separated constraints" :placeholder="freeTextSearchPlaceHolder" @change="freeTextChanged"></v-text-field>
  </v-col>

</template>

<script>

export default {
  data: function () {
    return {
    }
  },
  props: ['fieldResults'],
  methods: {
    chipClicked: function (name) {
      if (this.fieldResults.data.filter(tag => tag.name === name && tag.closable).length > 0) return
      const constraint = { fieldId: this.fieldResults.field.id, operation: (name === '__undefined' ? 'IS_UNDEFINED' : 'STRING_EQUAL'), expression: name, negate: false }
      this.$emit('add-constraint', constraint)
    },
    chipClosed: function (name) {
      const constraint = { fieldId: this.fieldResults.field.id, operation: (name === '__undefined' ? 'IS_UNDEFINED' : 'STRING_EQUAL'), expression: name, negate: false }
      this.$emit('remove-constraint', constraint)
    },
    freeTextChanged: function (clist) {
      const that = this
      const addConstraint = function (v) {
        const constraint = { fieldId: that.fieldResults.field.id, operation: (name === '__undefined' ? 'IS_UNDEFINED' : 'STRING_EQUAL'), expression: v, negate: false }
        that.$emit('add-constraint', constraint)
      }
      if (clist) {
        clist.split(',').map(c => c.trim()).forEach(c => addConstraint(c))
      }
    }
  },
  computed: {
    fieldResultsData: function () {
      if (this.fieldResults && !this.showFreeTextSearch) {
        return this.fieldResults.data
      }
      return []
    },
    showFreeTextSearch: function () {
      return this.fieldResults && this.fieldResults.data.find(tag => tag.name === '__overflow') !== undefined
    },
    freeTextSearchPlaceHolder: function () {
      return this.fieldResults.data.length > 0 ? 'e.g. ' + this.fieldResults.data[0].name + ', ..' : 'search...'
    }
  }
}
</script>

<style>
</style>
