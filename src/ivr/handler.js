require('dotenv').config()
// const fs = require('fs')
const path = require('path')
const fs = require('fs').promises
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg')
const ffmpeg = require('fluent-ffmpeg')

ffmpeg.setFfmpegPath(ffmpegInstaller.path)

async function convertAudio(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .audioFrequency(16000)
      .audioChannels(1)
      .audioBitrate('64k')
      .format('mp3')
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(`Error converting audio: ${err.message}`))
      .save(outputPath)
  })
}

async function deleteFile(filePath) {
  try {
    await fs.unlink(filePath)
    console.log(`Deleted file: ${filePath}`)
  } catch (err) {
    console.error(`Error deleting file: ${err.message}`)
  }
}

const {
  VOICEFLOW_API_KEY,
  TWILIO_PHONE_NUMBER,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_API_KEY,
  TWILIO_API_SECRET,
} = process.env

const VoiceResponse = require('twilio').twiml.VoiceResponse
// Using Auth Tokens
const SMS = require('twilio')(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
// Using API Key instead of Auth Tokens
/*
const SMS = require('twilio')(TWILIO_API_KEY, TWILIO_API_SECRET, {
  accountSid: TWILIO_ACCOUNT_SID,
})
*/

const axios = require('axios')
const VOICEFLOW_VERSION_ID = process.env.VOICEFLOW_VERSION_ID || 'development'
const VOICEFLOW_PROJECT_ID = process.env.VOICEFLOW_PROJECT_ID || null
let session = `${VOICEFLOW_VERSION_ID}.${createSession()}`
const RESET_STATE = process.env.RESET_STATE.toLowerCase() || 'false'

async function interact(caller, action) {
  const twiml = new VoiceResponse()
  // call the Voiceflow API with the user's name & request, get back a response
  const request = {
    method: 'POST',
    url: `https://general-runtime.voiceflow.com/state/user/${encodeURI(
      caller
    )}/interact`,
    headers: {
      Authorization: VOICEFLOW_API_KEY,
      sessionID: session,
      versionID: VOICEFLOW_VERSION_ID,
    },
    data: {
      action,
      config: { tts: true, stripSSML: true, stopTypes: ['DTMF'] },
    },
  }
  const response = await axios(request)

  const endTurn = response.data.some((trace) =>
    ['CALL', 'end'].includes(trace.type)
  )

  // Select the best model for your use case
  // https://www.twilio.com/docs/voice/twiml/gather#speechmodel

  let agent = endTurn
    ? twiml
    : twiml.gather({
        input: 'speech dtmf', // 'speech',
        numDigits: 4,
        finishOnKey: '#',
        hints: 'I need to check my account, Tico, Voiceflow, NiKo, yes',
        action: '/ivr/interaction',
        profanityFilter: false,
        actionOnEmptyResult: true,
        speechModel: 'experimental_utterances', // 'phone_call', 'numbers_and_commands','experimental_utterances', 'experimental_conversations', ...
        enhanced: true,
        speechTimeout: 'auto',
        language: 'en-US',
        method: 'POST',
      })

  // loop through the response
  for (const trace of response.data) {
    switch (trace.type) {
      case 'text':
      case 'speak': {
        if (trace.payload?.src) {
          if (trace.payload.src.startsWith('data:')) {
            const rawFileName = `raw-${Date.now()}.mp3`
            const tempFileName = `temp-${Date.now()}.mp3`
            const rawFilePath = path.join(process.cwd(), 'tmp', rawFileName)
            const tempFilePath = path.join(process.cwd(), 'tmp', tempFileName)

            const tempDir = path.join(process.cwd(), 'tmp')
            try {
              await fs.mkdir(tempDir)
            } catch (err) {
              if (err.code !== 'EEXIST') {
                throw err
              }
            }

            const base64Data = trace.payload.src.split(',')[1]
            await fs.writeFile(rawFilePath, base64Data, 'base64')

            await convertAudio(rawFilePath, tempFilePath)

            const audioUrl = `${process.env.BASE_URL}/ivr/audio/${tempFileName}`

            agent.play(audioUrl)
            setTimeout(async () => {
              await deleteFile(tempFilePath)
              await deleteFile(rawFilePath)
            }, 30000)
          } else {
            agent.play(trace.payload.src)
          }
        } else {
          agent.say(trace.payload.message)
        }
        break
      }
      case 'CALL': {
        const { number } = JSON.parse(trace.payload)
        console.log('Calling', number)
        twiml.dial(number)
        break
      }
      case 'SMS': {
        const { message } = JSON.parse(trace.payload)
        console.log('Sending SMS', message)
        console.log('To', caller)
        console.log('From', TWILIO_PHONE_NUMBER)

        SMS.messages
          .create({ body: message, to: caller, from: TWILIO_PHONE_NUMBER })
          .then((message) => {
            console.log('Message sent, SID:', message.sid)
          })
          .catch((error) => {
            console.error('Error sending message:', error)
          })
        break
      }
      case 'end': {
        saveTranscript(caller, true)
        twiml.hangup()
        break
      }
      default: {
      }
    }
  }
  if (endTurn === false) {
    saveTranscript(caller, false)
  }

  return twiml.toString()
}

async function deleteUserState(caller) {
  // call the Voiceflow API with the user's ID
  const request = {
    method: 'DELETE',
    url: `https://general-runtime.voiceflow.com/state/user/${encodeURI(
      caller
    )}`,
    headers: {
      Authorization: VOICEFLOW_API_KEY,
      versionID: VOICEFLOW_VERSION_ID,
    },
  }
  const response = await axios(request)
  return response
}

exports.launch = async (called, caller) => {
  return interact(caller, { type: 'launch' })
}

exports.interaction = async (called, caller, query = '', digit = null) => {
  let action = null
  if (digit) {
    // action = { type: `${digit}` } | Removing the need for a Custom Action
    action = digit ? { type: 'text', payload: digit } : null
    console.log('Digit:', digit)
  } else {
    action = query.trim() ? { type: 'text', payload: query } : null
    console.log('Utterance:', query)
  }

  return interact(caller, action)
}

exports.deleteState = async (caller) => {
  return deleteUserState(caller)
}

function createSession() {
  // Random Number Generator
  var randomNo = Math.floor(Math.random() * 1000 + 1)
  // get Timestamp
  var timestamp = Date.now()
  // get Day
  var date = new Date()
  var weekday = new Array(7)
  weekday[0] = 'Sunday'
  weekday[1] = 'Monday'
  weekday[2] = 'Tuesday'
  weekday[3] = 'Wednesday'
  weekday[4] = 'Thursday'
  weekday[5] = 'Friday'
  weekday[6] = 'Saturday'
  var day = weekday[date.getDay()]
  // Join random number+day+timestamp
  var session_id = randomNo + day + timestamp
  return session_id
}

async function saveTranscript(username, isEnd) {
  if (VOICEFLOW_PROJECT_ID) {
    console.log('SAVE TRANSCRIPT')
    if (!username || username == '' || username == undefined) {
      username = 'Anonymous'
    }
    axios({
      method: 'put',
      url: 'https://api.voiceflow.com/v2/transcripts',
      data: {
        browser: 'Twilio',
        device: 'Phone',
        os: 'Twilio',
        sessionID: session,
        unread: true,
        versionID: VOICEFLOW_VERSION_ID,
        projectID: VOICEFLOW_PROJECT_ID,
        user: {
          name: username,
          image:
            'https://s3.amazonaws.com/com.voiceflow.studio/share/twilio-logo-png-transparent/twilio-logo-png-transparent.png',
        },
      },
      headers: {
        Authorization: VOICEFLOW_API_KEY,
      },
    })
      .then(function (response) {
        console.log('Saved!')
        if (isEnd == true) {
          if (RESET_STATE === 'true') {
            console.log('Resetting state')
            deleteUserState(username)
          }
          session = `${process.env.VOICEFLOW_VERSION_ID}.${createSession()}`
        }
      })
      .catch((err) => console.log(err))
  } else {
    if (isEnd == true) {
      if (RESET_STATE === 'true') {
        console.log('Resetting state')
        deleteUserState(username)
      }
      session = `${process.env.VOICEFLOW_VERSION_ID}.${createSession()}`
    }
  }
}
