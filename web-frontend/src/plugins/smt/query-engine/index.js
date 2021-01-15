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
    that.fieldsList = smtConfig.fields

    return smtConfig
  },

  query: function (q) {
    const that = this
    console.assert(that.smtServerInfo.baseHashKey)
    const body = encodeURIComponent(JSON.stringify(q))
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
    const body = encodeURIComponent(JSON.stringify(q))
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
