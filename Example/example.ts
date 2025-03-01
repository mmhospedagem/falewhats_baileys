import { Boom } from '@hapi/boom'
import NodeCache from '@cacheable/node-cache'
import readline from 'readline'
import makeWASocket, { AnyMessageContent, BinaryInfo, delay, DisconnectReason, downloadAndProcessHistorySyncNotification, encodeWAM, fetchLatestBaileysVersion, getAggregateVotesInPollMessage, getHistoryMsg, isJidNewsletter, makeCacheableSignalKeyStore, makeInMemoryStore, proto, useMultiFileAuthState, WAMessageContent, WAMessageKey, WAMessageStubType } from '../src'
//import MAIN_LOGGER from '../src/Utils/logger'
import open from 'open'
import fs from 'fs'
import P from 'pino'

const logger = P({ timestamp: () => `,"time":"${new Date().toJSON()}"` }, P.destination('./wa-logs.txt'))
logger.level = 'trace'

const useStore = !process.argv.includes('--no-store')
const doReplies = process.argv.includes('--do-reply')
const usePairingCode = process.argv.includes('--use-pairing-code')

// external map to store retry counts of messages when decryption/encryption fails
// keep this out of the socket itself, so as to prevent a message decryption/encryption loop across socket restarts
const msgRetryCounterCache = new NodeCache()

const onDemandMap = new Map<string, string>()

// Read line interface
const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const question = (text: string) => new Promise<string>((resolve) => rl.question(text, resolve))

// the store maintains the data of the WA connection in memory
// can be written out to a file & read from it
const store = useStore ? makeInMemoryStore({ logger }) : undefined
store?.readFromFile('./baileys_store_multi.json')
// save every 10s
setInterval(() => {
	store?.writeToFile('./baileys_store_multi.json')
}, 10_000)

// start a connection


const filterMessages = (msg: any) => {
	if (msg.message?.protocolMessage) {
	  if(msg.message.protocolMessage.type === 'MESSAGE_EDIT' || msg.message.protocolMessage.type === 'REVOKE') {
		return true
	  }
	  return false
	}
	if(msg?.messageStubType === 2 && msg?.messageStubParameters[0] === 'Message absent from node') return true
	if(msg?.messageStubParameters && msg?.messageStubParameters[0] === 'Key used already or never filled') return true
	if (
	  [
		WAMessageStubType.E2E_DEVICE_CHANGED,
		WAMessageStubType.E2E_IDENTITY_CHANGED,
		WAMessageStubType.CIPHERTEXT,
		WAMessageStubType.CALL_MISSED_VOICE,
		WAMessageStubType.CALL_MISSED_VIDEO,
		WAMessageStubType.CALL_MISSED_GROUP_VOICE,
		WAMessageStubType.CALL_MISSED_GROUP_VIDEO
	  ].includes(msg.messageStubType)
	) { return false }
  
	return true
  }

  
const startSock = async() => {
	const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info')
	// fetch latest version of WA Web
	const { version, isLatest } = await fetchLatestBaileysVersion()
	console.log(`using WA v${version.join('.')}, isLatest: ${isLatest}`)

	const sock = makeWASocket({
		version,
		logger,
		printQRInTerminal: !usePairingCode,
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
		getMessage,
	})

	store?.bind(sock.ev)

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
				
				// WARNING: THIS WILL SEND A WAM EXAMPLE AND THIS IS A ****CAPTURED MESSAGE.****
				// DO NOT ACTUALLY ENABLE THIS UNLESS YOU MODIFIED THE FILE.JSON!!!!!
				// THE ANALYTICS IN THE FILE ARE OLD. DO NOT USE THEM.
				// YOUR APP SHOULD HAVE GLOBALS AND ANALYTICS ACCURATE TO TIME, DATE AND THE SESSION
				// THIS FILE.JSON APPROACH IS JUST AN APPROACH I USED, BE FREE TO DO THIS IN ANOTHER WAY.
				// THE FIRST EVENT CONTAINS THE CONSTANT GLOBALS, EXCEPT THE seqenceNumber(in the event) and commitTime
				// THIS INCLUDES STUFF LIKE ocVersion WHICH IS CRUCIAL FOR THE PREVENTION OF THE WARNING
				const sendWAMExample = false;
				if(connection === 'open' && sendWAMExample) {
					/// sending WAM EXAMPLE
					const {
						header: {
							wamVersion,
							eventSequenceNumber,
						},
						events,
					} = JSON.parse(await fs.promises.readFile("./boot_analytics_test.json", "utf-8"))

					const binaryInfo = new BinaryInfo({
						protocolVersion: wamVersion,
						sequence: eventSequenceNumber,
						events: events
					})

					const buffer = encodeWAM(binaryInfo);
					
					const result = await sock.sendWAMBuffer(buffer)
					console.log(result)
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
			if(events['messages.upsert']) {
				const upsert = events['messages.upsert']
				let messagesArray = upsert?.messages?.filter(filterMessages).map((mensagem) => mensagem);
				for (const message of messagesArray ){
					
					if(message.key.fromMe){
						console.log('msg minha')
						return
					} else {
						try{
						console.log('msg chegou', JSON.stringify(message))
						 
						//console.log('message', JSON.stringify(message))
							
							const interactiveMessage: proto.Message.IInteractiveMessage = {
								body: {
									text: "e ai blz"
								}, 
								header: {
									title: "olha que legal",
									hasMediaAttachment: false,
									// imageMessage: {
									// 	url: "https://www.google.com/images/branding/googlelogo/1x/googlelogo_color_272x92dp.png",
									// }
									// videoMessage: {
									// 	url: "https://www.w3schools.com/html/mov_bbb.mp4",
									// }
									// documentMessage: {
									// 	url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
									// 	title: "dummy.pdf"
									// }
								}, 
								nativeFlowMessage: {
									buttons: [
										// {
										// 	name: "quick_reply", 
										// 	buttonParamsJson: "{\"display_text\":\"SIM\",\"id\":\"6deb1c2f-7863-45eb-8b11-17a8f8131288\",\"disabled\":false}"
										// },
										// {
										// {
										// 	name: "cta_url", 
										// 	buttonParamsJson: "{\"display_text\":\"Ir para Site2\",\"id\":\"aaaaaa-7863-45eb-8b11-17a8f8132388\",\"url\":\"https://www.google.com.br\",\"disabled\":false}"
										// },
										// {
										// 	name: "cta_copy",
										// 	buttonParamsJson: "{\"display_text\":\"Copiar Código\",\"id\":\"6deb1c2f-7863-45eb-8b11-17a8f8131288\",\"copy_code\":\"123456\",\"disabled\":false}"
										// }
										{
											name: "cta_call",
											buttonParamsJson: "{\"display_text\":\"ligar\",\"id\":\"6deb1c2f-7863-45eb-8b11-17a8f8131288\",\"phone_number\":\"1234124456\",\"disabled\":false}"
										}
									]
								}
							}
							const interactiveMessage3: proto.Message.IInteractiveMessage = {
								body: {
									text: "Copia o codigo"
								}, 
								header: {
									title: "olha que legal"
								}, 
								nativeFlowMessage: {
									buttons: [
										{
											name: "cta_copy",
											buttonParamsJson: "{\"display_text\":\"Copiar Código\",\"id\":\"6deb1c2f-7863-45eb-8b11-17a8f8131288\",\"copy_code\":\"123456\",\"disabled\":false}"
										}
									]
								}
							}
							const interactiveMessage2: proto.Message.IInteractiveMessage = {
								body: {
									text: "agora com resposta"
								}, 
								header: {
									title: "olha que legal"
								}, 
								nativeFlowMessage: {
									buttons: [
										{
											name: "quick_reply", 
											buttonParamsJson: "{\"display_text\":\"LEGAL\",\"id\":\"6deb1c2f-7863-45eb-8b11-17a8f8131288\",\"disabled\":false}"
										},
										{
											name: "quick_reply", 
											buttonParamsJson: "{\"display_text\":\"IRADO\",\"id\":\"6deb1c2f-7863-45eb-8b11-17a8f8131288\",\"disabled\":false}"
										},
										{
											name: "quick_reply", 
											buttonParamsJson: "{\"display_text\":\"COOL\",\"id\":\"6deb1c2f-7863-45eb-8b11-17a8f8131288\",\"disabled\":false}"
										}
									
									]
								}
							}
							const messageToSend = {
								
								interactiveMessage: interactiveMessage
							}
							const messageToSend2 = {
								interactiveMessage: interactiveMessage2
							}
							const messageToSend3 = {
								interactiveMessage: interactiveMessage3
							}
							
	
							await sock.sendMessage(message.key.remoteJid!, messageToSend, {})
							await sock.sendMessage(message.key.remoteJid!, messageToSend2, {})
							await sock.sendMessage(message.key.remoteJid!, messageToSend3, {})
						
							const listMessage= {
								
									footer: 'footer',
									text: 'description',
									title: 'titulo',
									buttonText: 'clica',
									sections: [
										{
											title: 'section title',
											rows: [
												{
													title: 'row title',
													description: 'row description',
													rowId: "rowId",
												}
											]
										}
									]
								
							}
							await sock.sendMessage(message.key.remoteJid!, listMessage)
						
						} catch {
							console.log('erro ao enviar mensagem')

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
						const pollCreation = await getMessage(key)
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
		if(store) {
			const msg = await store.loadMessage(key.remoteJid!, key.id!)
			return msg?.message || undefined
		}

		// only if store is present
		return proto.Message.fromObject({})
	}
}

startSock()