const { json, send } = require('micro')
const moment = require('moment-timezone')
const fetch = require('node-fetch')

const cors = require('micro-cors')({
  allowMethods: ['POST']
})

const _toJSON = error => {
  return !error
    ? ''
    : Object.getOwnPropertyNames(error).reduce(
        (jsonError, key) => {
          return { ...jsonError, [key]: error[key] }
        },
        { type: 'error' }
      )
}

process.on('unhandledRejection', (reason, p) => {
  console.error(
    'Promise unhandledRejection: ',
    p,
    ', reason:',
    JSON.stringify(reason)
  )
})

module.exports = cors(async (req, res) => {
  if (req.method === 'OPTIONS') {
    return send(res, 204)
  }

  /*
{
  "resource_url": "https://api.shipengine.com/v1/tracking/usps/9361269903502070406152",
  "resource_type": "API_TRACK",
  "data": {
    "links": {
      "self": {
        "href": "https://api.shipengine.com/v1/tracking/usps/9361269903502070406152"
      },
      "label": null
    },
    "tracking_number": "9361269903502070406152",
    "status_code": "DE",
    "status_description": "Delivered",
    "carrier_status_code": "01",
    "carrier_status_description": "Your item was picked up at the post office...",
    "shipped_date": "2019-04-16T05:00:00.000Z",
    "estimated_delivery_date": null,
    "actual_delivery_date": "2019-04-17T02:33:38.252Z",
    "exception_description": null,
    "events": [
      {
        "event_date": "2019-04-17T02:33:38.252Z",
        "description": "Delivered, Individual Picked Up at Post Office",
        "city_locality": "AUSTIN",
        "state_province": "TX",
        "postal_code": "78721",
        "country_code": "",
        "company_name": "",
        "signer": ""
      }
    ]
  }
}
  */

  try {
    const tracking_update = await json(req)
    const {
      data: {
        tracking_number,
        status_description: status,
        carrier_status_description: status_details,
        estimated_delivery_date: eta,
        events
      }
    } = tracking_update

    let tracking_extra = {}
    if (tracking_update.extra) {
      tracking_extra = tracking_update.extra
    }
    let { billing_email, order_id } = tracking_extra
    // if (!order_id) {
    //   order_id = '730589c9-ee68-44b4-a201-bb38a9468abe'
    // }
    // if (!billing_email) {
    //   billing_email = 'adam@uniquelyparticular.com'
    // }

    if (order_id) {
      if (billing_email) {
        const payload = {
          profile: {
            source: 'support',
            identifiers: {
              email: billing_email
            }
          },
          event: {
            source: 'shipengine',
            type: 'shipping-status-change',
            description:
              status === 'DELIVERED' ? 'Order Delivered' : 'Shipping Update',
            created_at: moment(),
            properties: {
              'Tracking Status': status,
              'Order ID': order_id,
              'Tracking Number': tracking_number,
              'Service Type': service_type,
              'Estimated Delivery': moment(eta).format('MM/DD/YYYY'),
              'Tracking Notes': status_details
              // 'Tracking Location': `${location_city}, ${location_state} ${location_zip}`
            }
          }
        }

        fetch(
          `https://${
            process.env.ZENDESK_SUBDOMAIN
          }.zendesk.com/api/sunshine/track`,
          {
            headers: {
              Authorization: `Basic ${Buffer.from(
                `${process.env.ZENDESK_INTEGRATION_EMAIL}/token:${
                  process.env.ZENDESK_INTEGRATION_SECRET
                }`
              ).toString('base64')}`,
              Accept: 'application/json',
              'Content-Type': 'application/json'
            },
            method: 'POST',
            body: JSON.stringify(payload)
          }
        )
          .then(response => {
            if (response.ok && response.status < 299) {
              return send(
                res,
                200,
                JSON.stringify({ received: true, order_id })
              )
            } else {
              return send(res, 500, 'Error')
            }
          })
          .catch(error => {
            const jsonError = _toJSON(error)
            return send(res, 500, jsonError)
          })
      } else {
        console.error('missing billing_email')
        return send(res, 200, JSON.stringify({ received: true, order_id }))
      }
    } else {
      console.error('missing order_id')
      return send(
        res,
        200,
        JSON.stringify({ received: true, order_id: 'null' })
      )
    }
  } catch (error) {
    const jsonError = _toJSON(error)
    return send(res, 500, jsonError)
  }
})
