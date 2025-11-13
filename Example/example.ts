import { Boom } from '@hapi/boom'
import NodeCache from '@cacheable/node-cache'
import readline from 'readline'
import makeWASocket, { AnyMessageContent, BinaryInfo, CacheStore, delay, DisconnectReason, downloadAndProcessHistorySyncNotification, encodeWAM, fetchLatestBaileysVersion,
	generateWAMessageFromContent, getAggregateVotesInPollMessage, getHistoryMsg, isJidNewsletter, jidDecode, makeCacheableSignalKeyStore, normalizeMessageContent, PatchedMessageWithRecipientJID, proto, useMultiFileAuthState, WAMessageContent, WAMessageKey } from '../src'

import P from 'pino'

const logger = P({
  level: "trace",
  transport: {
    targets: [
      {
        target: "pino-pretty", // pretty-print for console
        options: { colorize: true },
        level: "trace",
      },
      {
        target: "pino/file", // raw file output
        options: { destination: './wa-logs.txt' },
        level: "trace",
      },
    ],
  },
})

const doReplies = process.argv.includes('--do-reply')
const usePairingCode = process.argv.includes('--use-pairing-code')

// external map to store retry counts of messages when decryption/encryption fails
// keep this out of the socket itself, so as to prevent a message decryption/encryption loop across socket restarts
const msgRetryCounterCache = new NodeCache() as CacheStore

const onDemandMap = new Map<string, string>()

// Read line interface
const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const question = (text: string) => new Promise<string>((resolve) => rl.question(text, resolve))

// start a connection
const startSock = async() => {
	const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info')
	// fetch latest version of WA Web
	const { version, isLatest } = await fetchLatestBaileysVersion()
	console.log(`using WA v${version.join('.')}, isLatest: ${isLatest}`)

	const sock = makeWASocket({
		version,
		logger,
		auth: {
			creds: state.creds,
			/** caching makes the store faster to send/recv messages */
			keys: makeCacheableSignalKeyStore(state.keys, logger),
		},
		msgRetryCounterCache,
		generateHighQualityLinkPreview: true,
		// ignore all broadcast messages -- to receive the same
		// comment the line below out
		// shouldIgnoreJid: jid => isJidBroadcast(jid),
		// implement to handle retries & poll updates
		getMessage
	})


	// Pairing code for Web clients
	if (usePairingCode && !sock.authState.creds.registered) {
		// todo move to QR event
		const phoneNumber = await question('Please enter your phone number:\n')
		const code = await sock.requestPairingCode(phoneNumber)
		console.log(`Pairing code: ${code}`)
	}

	const sendMessageWTyping = async(msg: AnyMessageContent, jid: string) => {
		await sock.presenceSubscribe(jid)
		await delay(500)

		await sock.sendPresenceUpdate('composing', jid)
		await delay(2000)

		await sock.sendPresenceUpdate('paused', jid)

		await sock.sendMessage(jid, msg)
	}

	// the process function lets you process all events that just occurred
	// efficiently in a batch
	sock.ev.process(
		// events is a map for event name => event data
		async(events) => {
			// something about the connection changed
			// maybe it closed, or we received all offline message or connection opened
			if(events['connection.update']) {
				const update = events['connection.update']
				const { connection, lastDisconnect } = update
				if(connection === 'close') {
					// reconnect if not logged out
					if((lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut) {
						startSock()
					} else {
						console.log('Connection closed. You are logged out.')
					}
				}
				console.log('connection update', update)
			}

			// credentials updated -- save them
			if(events['creds.update']) {
				await saveCreds()
			}

			if(events['labels.association']) {
				console.log(events['labels.association'])
			}


			if(events['labels.edit']) {
				console.log(events['labels.edit'])
			}

			if(events.call) {
				console.log('recv call event', events.call)
			}

			// history received
			if(events['messaging-history.set']) {
				const { chats, contacts, messages, isLatest, progress, syncType } = events['messaging-history.set']
				if (syncType === proto.HistorySync.HistorySyncType.ON_DEMAND) {
					console.log('received on-demand history sync, messages=', messages)
				}
				console.log(`recv ${chats.length} chats, ${contacts.length} contacts, ${messages.length} msgs (is latest: ${isLatest}, progress: ${progress}%), type: ${syncType}`)
			}

			// received a new message
      if (events['messages.upsert']) {
        const upsert = events['messages.upsert']
        console.log('recv messages ', JSON.stringify(upsert, undefined, 2))

        if (!!upsert.requestId) {
          console.log("placeholder message received for request of id=" + upsert.requestId, upsert)
        }



        if (upsert.type === 'notify') {
          for (const msg of upsert.messages) {
            if (msg.message?.conversation || msg.message?.extendedTextMessage?.text) {
              const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text
              if (text == "requestPlaceholder" && !upsert.requestId) {
                const messageId = await sock.requestPlaceholderResend(msg.key)
                console.log('requested placeholder resync, id=', messageId)
              }

              // go to an old chat and send this
              if (text == "onDemandHistSync") {
                const messageId = await sock.fetchMessageHistory(50, msg.key, msg.messageTimestamp!)
                console.log('requested on-demand sync, id=', messageId)
              }

              if (!msg.key.fromMe && doReplies && !isJidNewsletter(msg.key?.remoteJid!)) {

                console.log('replying to', msg.key.remoteJid)
                await sock!.readMessages([msg.key])
                await sendMessageWTyping({ text: 'Hello there!' }, msg.key.remoteJid!)
              }
            }
          }
        }
      }

			// messages updated like status delivered, message deleted etc.
			if(events['messages.update']) {
				console.log(
					JSON.stringify(events['messages.update'], undefined, 2)
				)

				for(const { key, update } of events['messages.update']) {
					if(update.pollUpdates) {
						const pollCreation: proto.IMessage = {} // get the poll creation message somehow
						if(pollCreation) {
							console.log(
								'got poll update, aggregation: ',
								getAggregateVotesInPollMessage({
									message: pollCreation,
									pollUpdates: update.pollUpdates,
								})
							)
						}
					}
				}
			}

			if(events['message-receipt.update']) {
				console.log(events['message-receipt.update'])
			}

			if(events['messages.reaction']) {
				console.log(events['messages.reaction'])
			}

			if(events['presence.update']) {
				console.log(events['presence.update'])
			}

			if(events['chats.update']) {
				console.log(events['chats.update'])
			}

			if(events['contacts.update']) {
				for(const contact of events['contacts.update']) {
					if(typeof contact.imgUrl !== 'undefined') {
						const newUrl = contact.imgUrl === null
							? null
							: await sock!.profilePictureUrl(contact.id!).catch(() => null)
						console.log(
							`contact ${contact.id} has a new profile pic: ${newUrl}`,
						)
					}
				}
			}

			if(events['chats.delete']) {
				console.log('chats deleted ', events['chats.delete'])
			}
		}
	)

	return sock

	async function getMessage(key: WAMessageKey): Promise<WAMessageContent | undefined> {
	  // Implement a way to retreive messages that were upserted from messages.upsert
			// up to you

		// only if store is present
		return proto.Message.create({ conversation: 'test' })
	}
}

const pg_pix_code = {
	reference_id: '1522563',
	type: 'digital-goods',
	payment_type: 'br',
	payment_settings: [
		{
			type: 'payment_link',
			payment_link: {
				uri: 'https://the-payment-link',
			},
		},
		{
			type: 'boleto',
			boleto: { digitable_line: '34191095866353261093675008900005412640000021128' },
		},
		{
			type: 'pix_dynamic_code',
			pix_dynamic_code: {
				code: '00020101021226770014BR.GOV.BCB.PIX2555api.itau/pix/qr/v2/3dca0c19-c1ce-4308-ac78-1cb1dbde4e1b5204000053039865802BR5915HINOVA PAYMENTS6014BELO HORIZONTE62070503***63044602',
				merchant_name: 'Aaprovel',
				key: '18391406000108',
				key_type: 'CNPJ',
			},
		},
	],
	currency: 'BRL',
	total_amount: { value: 21128, offset: 100 },
	order: {
		status: 'pending',
		tax: { value: 0, offset: 100, description: 'description' },
		items: [
			{
				retailer_id: '1266',
				name: 'Proteu00e7u00e3o veicular',
				amount: { value: 21128, offset: 100 },
				quantity: 1,
			},
		],
		subtotal: { value: 21128, offset: 100 },
	},
};


startSock()
	.then(async sock => {
		await delay(5000)
		console.log('---------------------FLOW-----------------------')
		const nativeFlowButton = {
			name: 'review_and_pay',
			buttonParamsJson: JSON.stringify(pg_pix_code),
			messageParamsJson: JSON.stringify({"bottom_sheet":{"in_thread_buttons_limit":3,"divider_indices":[]}})
		};

		const interactiveMessage: proto.Message.IInteractiveMessage = {
				body: {
					text: 'texto'
				},
				header: {
					title: 'titulo',
					hasMediaAttachment: false
				},
				footer: {
					text: 'footer'
				},
				nativeFlowMessage: {
					buttons: [nativeFlowButton]
				}
		}

		const jid = '556284879620@s.whatsapp.net'

		// Monta a mensagem no padrao
		const m = generateWAMessageFromContent(jid, { interactiveMessage }, {userJid: jid})

		await sock.sendMessage(jid, { interactiveMessage }, {});
		console.log('---------------------FLOW END-----------------------')
	})
	.catch(logger.error)
