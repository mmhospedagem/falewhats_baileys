import { decodeMessageNode } from '../../Utils/decode-wa-message'
import type { BinaryNode } from '../../WABinary'

describe('decodeMessageNode (Meta AI)', () => {
	test('decodes Meta AI @c.us messages as chat', () => {
		const stanza: BinaryNode = {
			tag: 'message',
			attrs: {
				id: 'TEST_MSG_ID',
				from: '13135550002@c.us',
				t: '1700000000'
			}
		}

		expect(() => decodeMessageNode(stanza, '999@s.whatsapp.net', '999@lid')).not.toThrow()
		const { fullMessage } = decodeMessageNode(stanza, '999@s.whatsapp.net', '999@lid')
		expect(fullMessage.key.remoteJid).toBe('13135550002@c.us')
	})

	test('does not throw when recipient is present on Meta AI messages', () => {
		const stanza: BinaryNode = {
			tag: 'message',
			attrs: {
				id: 'TEST_MSG_ID_2',
				from: '13135550002@c.us',
				recipient: '999@s.whatsapp.net',
				t: '1700000001'
			}
		}

		expect(() => decodeMessageNode(stanza, '999@s.whatsapp.net', '999@lid')).not.toThrow()
		const { fullMessage } = decodeMessageNode(stanza, '999@s.whatsapp.net', '999@lid')
		expect(fullMessage.key.remoteJid).toBe('13135550002@c.us')
		expect(fullMessage.key.fromMe).toBe(false)
	})
})

