import { Boom } from '@hapi/boom'
import NodeCache from '@cacheable/node-cache'
import readline from 'readline'
import makeWASocket, { CacheStore, DEFAULT_CONNECTION_CONFIG, delay, DisconnectReason, fetchLatestBaileysVersion, generateMessageIDV2, generateWAMessageFromContent, getAggregateVotesInPollMessage, isJidNewsletter, makeCacheableSignalKeyStore, prepareWAMessageMedia, proto, useMultiFileAuthState, WAMessageContent, WAMessageKey, WASocket } from '../src'
import P from 'pino'

const logger = P({
  level: "trace",
  transport: {
    targets: [
      {
        target: "pino-pretty", // pretty-print for console
        options: { colorize: true },
        level: "debug",
      },
      {
        target: "pino/file", // raw file output
        options: { destination: './wa-logs.json' },
        level: "trace",
      },
    ],
  },
})
logger.level = 'trace'

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
	// NOTE: For unit testing purposes only
	if (process.env.ADV_SECRET_KEY) {
		state.creds.advSecretKey = process.env.ADV_SECRET_KEY
	}
	// fetch latest version of WA Web
	const { version, isLatest } = await fetchLatestBaileysVersion()
	logger.debug({version: version.join('.'), isLatest}, `using latest WA version`)

	const sock = makeWASocket({
		version,
		logger,
		waWebSocketUrl: process.env.SOCKET_URL ?? DEFAULT_CONNECTION_CONFIG.waWebSocketUrl,
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

	// the process function lets you process all events that just occurred
	// efficiently in a batch
	sock.ev.process(
		// events is a map for event name => event data
		async(events) => {
			// something about the connection changed
			// maybe it closed, or we received all offline message or connection opened
			if(events['connection.update']) {
				const update = events['connection.update']
				const { connection, lastDisconnect, qr } = update
				if(connection === 'close') {
					// reconnect if not logged out
					if((lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut) {
						startSock()
					} else {
						logger.fatal('Connection closed. You are logged out.')
					}
				}

				if (qr) {
					// Pairing code for Web clients
					if (usePairingCode && !sock.authState.creds.registered) {
						const phoneNumber = await question('Please enter your phone number:\n')
						const code = await sock.requestPairingCode(phoneNumber)
						console.log(`Pairing code: ${code}`)
					}
				}

				logger.debug(update, 'connection update')
			}

			// credentials updated -- save them
			if(events['creds.update']) {
				await saveCreds()
				logger.debug({}, 'creds save triggered')
			}

			if(events['labels.association']) {
				logger.debug(events['labels.association'], 'labels.association event fired')
			}


			if(events['labels.edit']) {
				logger.debug(events['labels.edit'], 'labels.edit event fired')
			}

			if(events['call']) {
				logger.debug(events['call'], 'call event fired')
			}

			// history received
			if(events['messaging-history.set']) {
				const { chats, contacts, messages, isLatest, progress, syncType } = events['messaging-history.set']
				if (syncType === proto.HistorySync.HistorySyncType.ON_DEMAND) {
					logger.debug(messages, 'received on-demand history sync')
				}
				logger.debug({contacts: contacts.length, chats: chats.length, messages: messages.length, isLatest, progress, syncType: syncType?.toString() }, 'messaging-history.set event fired')
			}

			// received a new message
      if (events['messages.upsert']) {
        const upsert = events['messages.upsert']
        logger.debug(upsert, 'messages.upsert fired')

        if (!!upsert.requestId) {
          logger.debug(upsert, 'placeholder request message received')
        }



        if (upsert.type === 'notify') {
          for (const msg of upsert.messages) {
            if (msg.message?.conversation || msg.message?.extendedTextMessage?.text) {
              const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text
              if (text == "requestPlaceholder" && !upsert.requestId) {
                const messageId = await sock.requestPlaceholderResend(msg.key)
								logger.debug({ id: messageId }, 'requested placeholder resync')
              }

              // go to an old chat and send this
              if (text == "onDemandHistSync") {
                const messageId = await sock.fetchMessageHistory(50, msg.key, msg.messageTimestamp!)
                logger.debug({ id: messageId }, 'requested on-demand history resync')
              }

              if (!msg.key.fromMe && doReplies && !isJidNewsletter(msg.key?.remoteJid!)) {
              	const id = generateMessageIDV2(sock.user?.id)
              	logger.debug({id, orig_id: msg.key.id }, 'replying to message')
                await sock.sendMessage(msg.key.remoteJid!, { text: 'pong '+msg.key.id }, {messageId: id })
              }
            }
          }
        }
      }

			// messages updated like status delivered, message deleted etc.
			if(events['messages.update']) {
				logger.debug(events['messages.update'], 'messages.update fired')

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
				logger.debug(events['message-receipt.update'])
			}

			if (events['contacts.upsert']) {
				logger.debug(events['message-receipt.update'])
			}

			if(events['messages.reaction']) {
				logger.debug(events['messages.reaction'])
			}

			if(events['presence.update']) {
				logger.debug(events['presence.update'])
			}

			if(events['chats.update']) {
				logger.debug(events['chats.update'])
			}

			if(events['contacts.update']) {
				for(const contact of events['contacts.update']) {
					if(typeof contact.imgUrl !== 'undefined') {
						const newUrl = contact.imgUrl === null
							? null
							: await sock!.profilePictureUrl(contact.id!).catch(() => null)
						logger.debug({id: contact.id, newUrl}, `contact has a new profile pic` )
					}
				}
			}

			if(events['chats.delete']) {
				logger.debug('chats deleted ', events['chats.delete'] as any)
			}

			if(events['group.member-tag.update']) {
				// @ts-ignore
				logger.debug('group member tag update', JSON.stringify(events['group.member-tag.update'], undefined as any, 2))
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

async function sendCarousel(sock: WASocket, jid: string) {
  const image1 = await prepareWAMessageMedia(
    { image: { url: 'https://fastly.picsum.photos/id/1047/1000/650.jpg?grayscale&hmac=iOq8PPREkheQRVt0aqX4BMFWcK-hzo_OLJDkKCuYR78' } },
    { upload: sock.waUploadToServer }
  )

	logger.debug("image 1 - loaded")

  const image2 = await prepareWAMessageMedia(
    { image: { url: 'https://fastly.picsum.photos/id/532/1000/650.jpg?grayscale&hmac=mEKaZADt7nX8e8Q9qcAhRSj5Y3JZDesPegKuOWeGrwY' } },
    { upload: sock.waUploadToServer }
  )

	logger.debug("image 2 - loaded")

  return generateWAMessageFromContent(
    jid,
		{
			interactiveMessage: proto.Message.InteractiveMessage.create({
				body: {
					text: 'Escolha uma opção abaixo',
				},
				footer: {
					text: 'CodeChat',
				},
				header: {
					title: 'Catálogo',
					hasMediaAttachment: false,
				},
				carouselMessage: {
					cards: [
						{
							header: {
								title: 'Card 1',
								imageMessage: image1.imageMessage,
								hasMediaAttachment: true,
							},
							body: {
								text: 'Descrição do primeiro card',
							},
							footer: {
								text: 'Rodapé 1',
							},
							nativeFlowMessage: {
								buttons: [
									{
										name: 'quick_reply',
										buttonParamsJson: JSON.stringify({
											display_text: 'Selecionar',
											id: 'card_1',
										}),
									},
									{
										name: 'cta_url',
										buttonParamsJson: JSON.stringify({
											display_text: 'Abrir link',
											url: 'https://example.com/card-1',
										}),
									},
								],
							},
						},
						{
							header: {
								title: 'Card 2',
								imageMessage: image2.imageMessage,
								hasMediaAttachment: true,
							},
							body: {
								text: 'Descrição do segundo card',
							},
							footer: {
								text: 'Rodapé 2',
							},
							nativeFlowMessage: {
								buttons: [
									{
										name: 'quick_reply',
										buttonParamsJson: JSON.stringify({
											display_text: 'Selecionar',
											id: 'card_2',
										}),
									},
									{
										name: 'cta_url',
										buttonParamsJson: JSON.stringify({
											display_text: 'Abrir link',
											url: 'https://example.com/card-1',
										}),
									},
								],
							},
						},
					],
					carouselCardType: proto.Message.InteractiveMessage.CarouselMessage.CarouselCardType.HSCROLL_CARDS,
					messageVersion: 1
				},
			}),
		},
    { userJid:jid }
  )
}

startSock()
	.then(async sock => {
		await delay(2000)

		const jid = '556284879620@s.whatsapp.net'
		const ownJid = '553195918699@s.whatsapp.net'
		const ownLid = '153115802226704@lid'

		const send = await sendCarousel(sock, jid)

		console.log("Interactive:", JSON.stringify(send.message, null, 2))

		await sock.sendMessage(jid,{
			interactiveMessage:  send.message!.interactiveMessage!
		})
	})
	.catch(err => logger.error(err))