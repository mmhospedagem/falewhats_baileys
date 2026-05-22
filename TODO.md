## Update

### `src/Types/Products.ts`
- Adicionar ao tipo [`ProductBase`](./src/Types/Product.ts#30) as propriedades `salePrice?: string | number` e `price: string | number`

### `src/Utils/business.ts`
- Adicionar à função [**toProductNode**](src/Utils/business.ts#79) as [estrutura condicionais](src/Utils/business.ts#115):

	```ts
	if (typeof product.salePrice !== 'undefined') {
		content.push({
			tag: 'sale_price',
			attrs: {},
			content: Buffer.from(product.salePrice.toString())
		})
	}

	if (typeof product.url !== 'undefined') {
		content.push({
			tag: 'url',
			attrs: {},
			content: Buffer.from(product.url)
		})
	}
	```
- Adicionar à função [**parseProductNode**](src/Utils/business.ts#201) as variáveis:
	
	```ts
	const salePriceNode = getBinaryNodeChild(productNode, 'sale_price')
	const salePriceNodeChild = getBinaryNodeChildString(salePriceNode, 'price')
	```
- Adisionar a propriedade [`salePrice`](src/Utils/business.ts#223) ao objeto [`product`](src/Utils/business.ts#211) para o retorno da função **toProductNode**:
	```ts
	const product: Product = {
		...
		salePrice: salePriceNodeChild? +salePriceNodeChild : undefined,
		...
	}
	```

### `src/Utils/message.ts`
- Adicionar a função exportável [**isNativeFlowSpecials**](./src/Utils/messages.ts#1110)
	```ts
		export const isNativeFlowSpecials = (value: string) => [
			'mpm',
			'cta_catalog',
			'send_location',
			'call_permission_request',
			'wa_payment_transaction_details',
			'automated_greeting_message_view_catalog',
			'payment_info',
			'review_and_pay',
			'review_order',
		].includes(value)
	```
- Adicionar à função [**generateWAMessageContent**](./src/Utils/messages.ts#392):
	- a [condição](./src/Utils/messages.ts#606):
		```ts
		else if (hasNonNullishProperty(message, 'interactiveMessage')) {
			m.interactiveMessage = message['interactiveMessage']
		}
		```
	- a estrutura condicional

- Modificar função [**hasNonNullishProperty**](./src/Utils/messages.ts#377) para:
	```ts
	export const hasNonNullishProperty = <K extends PropertyKey>(
		message: AnyMessageContent,
		key: K
	): message is ExtractByKey<AnyMessageContent, K> => {
		return (
			typeof message === 'object' &&
			key in message &&
			!!(message as any)[key]
		)
	}
	```
- Estrutura condicional depreciada [~~`buttons`~~](./src/Utils/messages.ts#619) e [~~`sections`~~](./src/Utils/messages.ts#679); usamos agora o `interactiveMessage`

### `src/Socket/socket.ts`
- Adicionar ao retorno da função [**makeSocket**](./src/Socket/socket.ts) a propriedade [`pnFromLIDUSync`](src/Socket/socket.ts#1130)

### `src/Socket/messages-send.ts`
Adicionar `função [**relayMessage**](./src/Socket/messages-send.ts#604):
- a função [**getButtonType**](./src/Socket/messages-send.ts#1145):
	```ts
	const getButtonType = (message: proto.IMessage) => {
		if(message.buttonsMessage) {
			return 'buttons'
		} else if(message.buttonsResponseMessage) {
			return 'buttons_response'
		} else if(message.interactiveResponseMessage) {
			return 'interactive_response'
		} else if(message.listMessage) {
			return 'list'
		} else if(message.listResponseMessage) {
			return 'list_response'
		} else if(message.interactiveMessage) {
			return 'interactive'
		}
	}
	```
- a função [**getButtonAttrs**](./src/Socket/messages-send.ts#1193):
	```ts
		const getButtonAttrs = (message: proto.IMessage, nativeFlowSpecial?: string): BinaryNode['attrs'] => {
			if (message.interactiveMessage?.nativeFlowMessage) {
				switch (nativeFlowSpecial) {
					case 'review_and_pay':
					case 'payment_info':
						return {
							native_flow_name: nativeFlowSpecial === 'review_and_pay' ? 'order_details' : nativeFlowSpecial
						}
					default:
						return {
							actual_actors: '2',
							host_storage: '2',
							privacy_mode_ts: unixTimestampSeconds().toString()
						}
				}
			} else if (message.templateMessage) {
				// TODO: Add attributes
				return {}
			} else if (message.listMessage) {
				const type: proto.Message.ListMessage.ListType | null | undefined = message.listMessage.listType
				if (!type) {
					throw new Boom('Expected list type inside message')
				}

				return { v: '2', type: proto.Message.ListMessage.ListType[type].toLowerCase() }
			} else {
				return {}
			}
		}
	```
- a função [**getButtonContent**](./src/Socket/messages-send.ts#1145):
	```ts
	const getButtonContent = (message: proto.IMessage, nativeFlowSpecial?: string): BinaryNode['content'] => {
		if (message.interactiveMessage?.nativeFlowMessage && nativeFlowSpecial) {
			switch (nativeFlowSpecial) {
				case 'review_and_pay':
				case 'payment_info':
					return []
				default:
					return [{
						tag: 'interactive',
						attrs: {
							type: 'native_flow',
							v: '1'
						},
						content: [{
							tag: 'native_flow',
							attrs: {
								v: '2',
								name: nativeFlowSpecial || 'mixed'
							}
						}]
					},
						{
							tag: 'quality_control',
							attrs: {
								source_type: 'third_party'
							}
						}]
			}
		} else if (message.interactiveMessage?.nativeFlowMessage) {
			return [{
				tag: 'interactive',
				attrs: {
					type: 'native_flow',
					v: '1'
				},
				content: [{
					tag: 'native_flow',
					attrs: {
						v: '9',
						name: 'mixed'
					}
				}]
			}]
		} else {
			return []
		}
	}
	```
- as [variáveis](./src/Socket/messages-send.ts#651):
	```ts
	const normalizedMessage: proto.IMessage | undefined = normalizeMessageContent(message)
	const isInteractiveMessage: boolean = getContentType(normalizedMessage) === 'interactiveMessage'
	```
- a [estrutura condicional](./src/Socket/messages-send.ts#667)
	```ts
	if (isInteractiveMessage) {
		additionalAttributes = { ...additionalAttributes, 'device_fanout': 'false' }
	}
	```
- a variável [`nativeFlow`](./src/Socket/messages-send.ts#1025)
	```ts
	const nativeFlow = message?.interactiveMessage?.nativeFlowMessage ||
		message?.viewOnceMessage?.message?.interactiveMessage?.nativeFlowMessage ||
		message?.viewOnceMessageV2?.message?.interactiveMessage?.nativeFlowMessage ||
		message?.viewOnceMessageV2Extension?.message?.interactiveMessage?.nativeFlowMessage
	```
- a variável [`firstButtonName`](./src/Socket/messages-send.ts#1023):
	```ts
	const firstButtonName = nativeFlow?.buttons?.[0]?.name
	```
- a variável [`buttonType`](./src/Socket/messages-send.ts#1032):
	```ts
	const buttonType = getButtonType(message)
	```
- a [estrutura condicional](./src/Socket/messages-send.ts#1032):
	```ts
	if(buttonType) {
		const bizNode: BinaryNode = { tag: 'biz', attrs: {} }

		if (nativeFlow && (firstButtonName === 'review_and_pay' || firstButtonName === 'payment_info')) {
			bizNode.attrs = {
				native_flow_name: firstButtonName === 'review_and_pay' ? 'order_details' : firstButtonName
			}
		} else if (nativeFlow && isNativeFlowSpecials(firstButtonName || '')) {
			bizNode.content = [{
				tag: 'biz',
				attrs: {
					actual_actors: '2',
					host_storage: '2',
					privacy_mode_ts: unixTimestampSeconds().toString()
				},
				content: [{
					tag: 'interactive',
					attrs: {
						type: 'native_flow',
						v: '1'
					},
					content: [{
						tag: 'native_flow',
						attrs: {
							v: '2',
							name: firstButtonName || 'mixed'
						}
					}]
				},
					{
						tag: 'quality_control',
						attrs: {
							source_type: 'third_party'
						}
					}]
			}]
		} else if (
			nativeFlow || message?.buttonsMessage ||
			message?.viewOnceMessage?.message?.buttonsMessage ||
			message?.viewOnceMessageV2?.message?.buttonsMessage ||
			message?.viewOnceMessageV2Extension?.message?.buttonsMessage ||
			message?.interactiveMessage?.carouselMessage
		) {
			bizNode.attrs = {
				actual_actors: '2',
				host_storage: '2',
				privacy_mode_ts: unixTimestampSeconds().toString()
			}
			bizNode.content = [{
				tag: 'interactive',
				attrs: {
					type: 'native_flow',
					v: '1'
				},
				content: [{
					tag: 'native_flow',
					attrs: {
						v: '9',
						name: 'mixed'
					}
				}]
			}]
		} else if (message?.listMessage) {
			bizNode.content = [{
				tag: 'list',
				attrs: {
					type: 'product_list',
					v: '2'
				}
			}]
		} else {
			bizNode.content = [
				{
					tag: buttonType,
					attrs: firstButtonName ? getButtonAttrs(message, isNativeFlowSpecials(firstButtonName) ? firstButtonName : undefined) : getButtonAttrs(message),
					content: firstButtonName ? getButtonContent(message, isNativeFlowSpecials(firstButtonName) ? firstButtonName : undefined) : getButtonContent(message)
				}
			]
		}

		(stanza.content as BinaryNode[]).push(bizNode)
	}
	```

---

# Executar:

### 1. Trocar a URL do repositório remoto

Se já existe um `origin`:

```bash
git remote set-url origin https://github.com/code-chat-br/wa-connect
```
---

### 2. Garantir que você está na branch correta

```bash
git branch
```

Se não estiver na `main`:

```bash
git checkout -B main
```

> Isso aqui já sobrescreve qualquer estado da `main` local. Sem dó.

---

### 3. Commitar tudo (se ainda não fez)

```bash
git add .
git commit -m "reset project"
```