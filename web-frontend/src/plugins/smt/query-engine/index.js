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

import marked from 'marked'
import stableStringify from 'json-stable-stringify'
import _ from 'lodash'

export default {
  fieldsList: undefined,
  smtServerInfo: undefined,

  init: async function () {
    const that = this

    let resp = await fetch(process.env.VUE_APP_SMT_SERVER + '/api/v1/smtServerInfo', {
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      }
    })
    that.smtServerInfo = await resp.json()

    resp = await fetch(process.env.VUE_APP_SMT_SERVER + '/api/v1/smtConfig', {
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      }
    })
    const smtConfig = await resp.json()
    for (const f of smtConfig.fields) {
      f.description_html = marked(f.description)
    }
    that.fieldsList = smtConfig.fields

    return smtConfig
  },

  queryToString: function (q) {
    const q2 = _.cloneDeep(q)
    q2.constraints.sort((c1, c2) => {
      const a = c1.fieldId + c1.operation + c1.expression
      const b = c2.fieldId + c2.operation + c2.expression
      return (a > b) - (a < b)
    })
    return stableStringify(q2)
  },

  query: function (q) {
    const that = this
    console.assert(that.smtServerInfo.baseHashKey)
    const body = encodeURIComponent(this.queryToString(q))
    return fetch(process.env.VUE_APP_SMT_SERVER + '/api/v1/' + that.smtServerInfo.baseHashKey + '/query?q=' + body, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      }
    }).then(function (response) {
      return response.json()
    })
  },

  queryVisual: function (q) {
    const that = this
    console.assert(that.smtServerInfo.baseHashKey)
    const body = encodeURIComponent(stableStringify(q))
    return fetch(process.env.VUE_APP_SMT_SERVER + '/api/v1/' + that.smtServerInfo.baseHashKey + '/queryVisual?q=' + body, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      }
    }).then(function (response) {
      return response.text()
    })
  }
}
