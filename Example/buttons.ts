import { proto } from '../WAProto'
import { WALocationMessage } from '../src'

export const buttons = [
	// {
	//   name: 'cta_url',
	//   buttonParamsJson: JSON.stringify({
	//     display_text: 'Excelente - Visite nosso site',
	//     url: 'https://google.com',
	//   }),
	// },
	// {
	//   name: 'cta_call',
	//   buttonParamsJson: JSON.stringify({
	//     display_text: 'Falar com atendente',
	//     phone_number: '+55 31 9 9785-3327',
	//   }),
	// },
	// {
	//   name: 'cta_copy',
	//   buttonParamsJson: JSON.stringify({
	//     display_text: '📋 Copiar Link',
	//     copy_code: 'hahahaha curioso',
	//   }),
	// },
	{
		name: 'quick_reply',
		buttonParamsJson: JSON.stringify({
			display_text: 'Sim',
			id: '1',
		}),
	},
	{
		name: 'quick_reply',
		buttonParamsJson: JSON.stringify({
			display_text: 'Não',
			id: '2',
		}),
	},
	{
		name: 'quick_reply',
		buttonParamsJson: JSON.stringify({
			display_text: 'Talvez',
			id: '3',
		}),
	},
]

export const review_order = {
	reference_id: 'cc_1763249184414',
	order: { status: 'shipped', order_type: 'ORDER' },
	share_payment_status: true,
};

// key type: PHONE - EVP - EMAIL - CPF - CNPJ
export const pix = {
	payment_settings: [
		{
			pix_static_code: {
				key_type: 'EVP',
				merchant_name: 'CodeChat',
				key: '00020101021226770014BR.GOV.BCB.PIX2555api.itau/pix/qr/v2/3dca0c19-c1ce-4308-ac78-1cb1dbde4e1b5204000053039865802BR5915HINOVA PAYMENTS6014BELO HORIZONTE62070503***63044602',
			},
			type: 'pix_static_code',
		},
	],
	order: {
		status: 'pending',
		subtotal: { value: 0, offset: 100 },
		order_type: 'ORDER',
		items: [],
	},
	total_amount: { value: 0, offset: 100 },
	share_payment_status: false,
	referral: 'chat_attachment',
	currency: 'BRL',
	reference_id: Date.now() + '_cc',
	type: 'physical-goods',
};

const data_payment = {
	reference_id: Date.now() + '_cc',
	type: 'physical-goods',
	currency: 'BRL',
	total_amount: { value: 262599, offset: 1000 },
	order_request_id: '4TMUOINTKJI',
	order: {
		status: 'pending',
		items: [
			{
				retailer_id: 'custom-item-4TMUOEZSCT2',
				name: 'Produto 1',
				amount: { value: 13900, offset: 1000 },
				quantity: 10,
				isCustomItem: true,
				isQuantitySet: true,
				description: 'Descrição do produto 1'
			},
			{
				retailer_id: 'custom-item-4TMUOA1N0LZ',
				name: 'Produto 2',
				amount: { value: 5550, offset: 1000 },
				quantity: 13,
				isCustomItem: true,
				isQuantitySet: true,
				description: 'Descrição do produto 2'
			},
		],
		subtotal: { value: 211150, offset: 1000 },
		tax: { value: 36106, offset: 1000, description: 'ICMS' },
		shipping: { value: 25900, offset: 1000, description: 'Valor da entrega' },
		discount: { value: 10557, offset: 1000, description: 'Desconto fidelidade' },
	},
	payment_settings: [
		{
			type: 'pix_dynamic_code',
			pix_dynamic_code: {
				code: '00020101021226770014BR.GOV.BCB.PIX2555api.itau/pix/qr/v2/3dca0c19-c1ce-4308-ac78-1cb1dbde4e1b5204000053039865802BR5915HINOVA PAYMENTS6014BELO HORIZONTE62070503***63044602',
				merchant_name: 'Aaprovel',
				key_type: 'EVP',
				key: '+5531997853327'
			},
		},
		{ type: 'cards', cards: { enabled: false } },
	],
};

const pg_pix_code = {
	reference_id: 'cc_' + Date.now(),
	type: 'physical-goods',
	payment_type: 'br',
	payment_settings: [
		{
			type: 'boleto',
			boleto: {
				digitable_line: '34191095866353261093675008900005412640000021128'
			},
		},
	],
	currency: 'BRL',
	total_amount: { value: 262599, offset: 1000 },
	order: {
		status: 'payment_requested',
		items: [
			{
				retailer_id: 'custom-item-4TMUOEZSCT2',
				name: 'Produto 1',
				amount: { value: 13900, offset: 1000 },
				quantity: 10,
				isCustomItem: true,
				isQuantitySet: true,
				description: 'Descrição do produto 1',
			},
			{
				retailer_id: 'custom-item-4TMUOA1N0LZ',
				name: 'Produto 2',
				amount: { value: 5550, offset: 1000 },
				quantity: 13,
				isCustomItem: true,
				isQuantitySet: true,
				description: 'Descrição do produto 2'
			},
		],
		subtotal: { value: 211150, offset: 1000 },
		tax: { value: 36106, offset: 1000, description: 'ICMS' },
		shipping: { value: 25900, offset: 1000, description: 'Valor da entrega' },
		discount: { value: 10557, offset: 1000, description: 'Desconto fidelidade' },
	},
};

export const review_and_pay = {
	name: 'review_and_pay',
	buttonParamsJson: JSON.stringify(data_payment),
	messageParamsJson: JSON.stringify({"bottom_sheet":{"in_thread_buttons_limit":5,"divider_indices":[]}})
};
export const review_order_pay = {
	name: 'review_order',
	buttonParamsJson: JSON.stringify(review_order),
	messageParamsJson: JSON.stringify({"bottom_sheet":{"in_thread_buttons_limit":3,"divider_indices":[]}})
};

export const payment_info_pix = {
	name: 'payment_info',
	buttonParamsJson: JSON.stringify(pix),
	messageParamsJson: JSON.stringify({"bottom_sheet":{"in_thread_buttons_limit":3,"divider_indices":[]}})
}

const interactiveMessage: proto.Message.IInteractiveMessage = {
	body: {
		text: 'Code :' + Date.now()
	},
	header: {
		hasMediaAttachment: true,
		// imageMessage: up.imageMessage
	},
	footer: {
		text: 'CodeChat®'
	},
	nativeFlowMessage: {
		buttons: [review_and_pay]
	}
}

type EventMessageOptions = {
	name: string
	description?: string
	startDate: Date
	endDate?: Date
	location?: WALocationMessage
	call?: 'audio' | 'video'
	joinLink?: string
	isCancelled?: boolean
	isScheduleCall?: boolean
	extraGuestsAllowed?: boolean
	messageSecret?: Uint8Array<ArrayBufferLike>
}

const startDate = new Date()
startDate.setMinutes(startDate.getMinutes() + 2)
const endDate = new Date(startDate.getTime());
endDate.setHours(endDate.getHours() + 1);
export const event: EventMessageOptions = {
	name: 'MMhospedagem - Tipo 2',
	description: 'Teste de evento',
	startDate,
	endDate,
	call: 'video',
	location: {
		name: 'Escritório',
		address: 'Endereço completo',
		degreesLongitude: 0,
		degreesLatitude: 0
	}
}
