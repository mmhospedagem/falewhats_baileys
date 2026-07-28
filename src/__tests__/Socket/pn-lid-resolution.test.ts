import { jest } from '@jest/globals'
import P from 'pino'
import { DEFAULT_CONNECTION_CONFIG } from '../../Defaults'
import { WebSocketClient } from '../../Socket/Client'
import { makeMessagesSocket } from '../../Socket/messages-send'
import type { SocketConfig } from '../../Types'
import { decodeBinaryNode, type BinaryNode } from '../../WABinary'

const originalConnect = WebSocketClient.prototype.connect
const originalSend = WebSocketClient.prototype.send
const originalClose = WebSocketClient.prototype.close
const originalIsOpenDescriptor = Object.getOwnPropertyDescriptor(WebSocketClient.prototype, 'isOpen')

type LidMappingMock = {
	getLIDForPN: jest.Mock<(pn: string) => Promise<string | null>>
	getPNForLID: jest.Mock<(lid: string) => Promise<string | null>>
	getLIDsForPNs: jest.Mock<(pns: string[]) => Promise<{ pn: string; lid: string }[] | null>>
}

type SentFrame = string | Uint8Array

const logger = P({ level: 'silent' })

async function decodeSentNode(frame: SentFrame): Promise<BinaryNode | null> {
	const buffer = typeof frame === 'string' ? Buffer.from(frame, 'binary') : Buffer.from(frame)
	for (let offset = 0; offset < Math.min(20, buffer.length); offset += 1) {
		try {
			return await decodeBinaryNode(buffer.slice(offset))
		} catch {
			// Keep scanning until we hit the encoded stanza payload.
		}
	}

	return null
}

describe('PN to LID resolution', () => {
	let mockLidMapping: LidMappingMock
	let sentFrames: SentFrame[]

	beforeAll(() => {
		WebSocketClient.prototype.connect = jest.fn()
		WebSocketClient.prototype.close = jest.fn(async () => {})
		Object.defineProperty(WebSocketClient.prototype, 'isOpen', {
			get: () => true,
			configurable: true
		})

		WebSocketClient.prototype.send = jest.fn(function (
			this: InstanceType<typeof WebSocketClient>,
			data: SentFrame,
			cb?: (err?: Error) => void
		) {
			sentFrames.push(data)
			cb?.(undefined)

			const tagListeners = this.eventNames().filter(
				(name): name is string => typeof name === 'string' && name.startsWith('TAG:')
			)

			for (const eventName of tagListeners) {
				const tag = eventName.slice(4)
				process.nextTick(() => {
					this.emit(eventName, {
						tag: 'iq',
						attrs: { id: tag, type: 'result' },
						content: []
					})
				})
			}

			return true
		})
	})

	afterAll(() => {
		WebSocketClient.prototype.connect = originalConnect
		WebSocketClient.prototype.send = originalSend
		WebSocketClient.prototype.close = originalClose
		if (originalIsOpenDescriptor) {
			Object.defineProperty(WebSocketClient.prototype, 'isOpen', originalIsOpenDescriptor)
		}
	})

	beforeEach(() => {
		jest.clearAllMocks()
		sentFrames = []
		mockLidMapping = {
			getLIDForPN: jest.fn<(pn: string) => Promise<string | null>>(),
			getPNForLID: jest.fn<(lid: string) => Promise<string | null>>(),
			getLIDsForPNs: jest.fn<(pns: string[]) => Promise<{ pn: string; lid: string }[] | null>>()
		}
		mockLidMapping.getPNForLID.mockResolvedValue(null)
		mockLidMapping.getLIDsForPNs.mockResolvedValue([])
	})

	function createSocket() {
		const config = {
			...DEFAULT_CONNECTION_CONFIG,
			logger,
			auth: {
				creds: {
					me: { id: '556493013832@s.whatsapp.net', lid: '208688988053672@lid' }
				},
				keys: {
					get: jest.fn(async () => ({})),
					set: jest.fn(async () => {})
				}
			},
			makeSignalRepository: jest.fn(() => ({
				lidMapping: mockLidMapping,
				validateSession: jest.fn(async () => ({ exists: true })),
				encryptMessage: jest.fn(async () => ({ type: 'pkmsg', ciphertext: Buffer.from('cipher') })),
				encryptGroupMessage: jest.fn(async () => ({
					ciphertext: Buffer.from('cipher'),
					senderKeyDistributionMessage: Buffer.from('skdm')
				})),
				hasSenderKey: jest.fn(async () => false)
			})),
			options: {}
		} as unknown as SocketConfig

		return makeMessagesSocket(config)
	}

	async function getLastMessageNode(): Promise<BinaryNode> {
		for (let index = sentFrames.length - 1; index >= 0; index -= 1) {
			const decoded = await decodeSentNode(sentFrames[index]!)
			if (decoded?.tag === 'message') {
				return decoded
			}
		}

		throw new Error('No outgoing message stanza found')
	}

	it('keeps PN destination when no mapped LID exists', async () => {
		mockLidMapping.getLIDForPN.mockResolvedValue(null)
		const sock = createSocket()

		await sock.sendMessage('12345@s.whatsapp.net', { text: 'test' })

		expect(mockLidMapping.getLIDForPN).toHaveBeenCalledWith('12345@s.whatsapp.net')
		await expect(getLastMessageNode()).resolves.toMatchObject({
			attrs: { to: '12345@s.whatsapp.net' }
		})
	})

	it('resolves PN destination to mapped LID before sending', async () => {
		mockLidMapping.getLIDForPN.mockResolvedValue('98765@lid')
		const sock = createSocket()

		await sock.sendMessage('12345@s.whatsapp.net', { text: 'test' })

		expect(mockLidMapping.getLIDForPN).toHaveBeenCalledWith('12345@s.whatsapp.net')
		await expect(getLastMessageNode()).resolves.toMatchObject({
			attrs: { to: '98765@lid' }
		})
	})

	it('falls back to the original PN when mapping lookup throws', async () => {
		mockLidMapping.getLIDForPN.mockRejectedValue(new Error('Database disconnect'))
		const sock = createSocket()

		await sock.sendMessage('12345@s.whatsapp.net', { text: 'test' })

		expect(mockLidMapping.getLIDForPN).toHaveBeenCalledWith('12345@s.whatsapp.net')
		await expect(getLastMessageNode()).resolves.toMatchObject({
			attrs: { to: '12345@s.whatsapp.net' }
		})
	})

	it('does not query PN mapping for direct LID sends', async () => {
		const sock = createSocket()

		await sock.sendMessage('98765@lid', { text: 'test' })

		expect(mockLidMapping.getLIDForPN).not.toHaveBeenCalled()
		await expect(getLastMessageNode()).resolves.toMatchObject({
			attrs: { to: '98765@lid' }
		})
	})

	it('does not query PN mapping for newsletters', async () => {
		const sock = createSocket()

		await sock.sendMessage('120363234@newsletter', { text: 'test' })

		expect(mockLidMapping.getLIDForPN).not.toHaveBeenCalled()
		await expect(getLastMessageNode()).resolves.toMatchObject({
			attrs: { to: '120363234@newsletter' }
		})
	})

	it('does not query PN mapping for status broadcast', async () => {
		const sock = createSocket()

		await sock.sendMessage('status@broadcast', { text: 'test' })

		expect(mockLidMapping.getLIDForPN).not.toHaveBeenCalled()
		await expect(getLastMessageNode()).resolves.toMatchObject({
			attrs: { to: 'status@broadcast' }
		})
	})
})
