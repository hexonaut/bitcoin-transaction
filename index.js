var bitcoin = require('bitcoinjs-lib');
var request = require('superagent');

var BITCOIN_DIGITS = 8;

var providers = {
	/**
	 * Input: Requested processing speed. "fastest", "halfHour" or "hour"
	 * Output: Fee rate in Satoshi's per Byte.
	 */
	fees: {
		mainnet: {
			earn: function (feeName) {
				return request.get('https://bitcoinfees.earn.com/api/v1/fees/recommended').send().then(function (res) {
					return res[feeName + "fee"];
				});
			}
		},
		testnet: {
			earn: function (feeName) {
				return request.get('https://bitcoinfees.earn.com/api/v1/fees/recommended').send().then(function (res) {
					return res[feeName + "fee"];
				});
			}
		}
	},
	/**
	 * Input: Sending user's BitCoin wallet address.
	 * Output: List of utxo's to use. Must be in standard format. { txid, vout, satoshis, confirmations }
	 */
	utxo: {
		mainnet: {
			blockexplorer: function (addr) {
				return request.get('https://blockexplorer.com/api/addr/' + addr + '/utxo?noCache=1').send().then(function (utxos) {
					return utxos.map(function (e) {
						return {
							txid: e.txid,
							vout: e.vout,
							satoshis: e.satoshis,
							confirmations: e.confirmations
						};
					});
				});
			},
			blockchain: function (addr) {
				return request.get('https://blockchain.info/unspent?active=' + addr).send().then(function (utxos) {
					return utxos.map(function (e) {
						return {
							txid: e.tx_hash_big_endian,
							vout: e.tx_output_n,
							satoshis: e.value,
							confirmations: e.confirmations
						};
					});
				});
			}
		},
		testnet: {
			blockexplorer: function (addr) {
				return request.get('https://testnet.blockexplorer.com/api/addr/' + addr + '/utxo?noCache=1').send().then(function (utxos) {
					return utxos.map(function (e) {
						return {
							txid: e.txid,
							vout: e.vout,
							satoshis: e.satoshis,
							confirmations: e.confirmations
						};
					});
				});
			}
		}
	},
	/**
	 * Input: A hex string transaction to be pushed to the blockchain.
	 * Output: None
	 */
	pushtx: {
		mainnet: {
			blockexplorer: function (hexTrans) {
				return request.post('https://blockexplorer.info/api/tx/send').send('rawtx: ' + hexTrans);
			},
			blockchain: function (hexTrans) {
				return request.post('https://blockchain.info/pushtx').send('tx=' + hexTrans);
			}
		},
		testnet: {
			blockexplorer: function (hexTrans) {
				return request.post('https://testnet.blockexplorer.info/api/tx/send').send('rawtx: ' + hexTrans);
			}
		}
	}
}

//Set default providers
providers.fees.mainnet.default = providers.fees.mainnet.earn;
providers.fees.testnet.default = providers.fees.testnet.earn;
providers.utxo.mainnet.default = providers.utxo.mainnet.blockexplorer;
providers.utxo.testnet.default = providers.utxo.testnet.blockexplorer;
providers.pushtx.mainnet.default = providers.pushtx.mainnet.blockchain;
providers.pushtx.testnet.default = providers.pushtx.testnet.blockexplorer;

function getTransactionSize (numInputs, numOutputs) {
	return numInputs*180 + numInputs*34 + 10 + numInputs;
}

function getFees (provider, feeName) {
	if (typeof feeName === 'number') {
		return new Promise.resolve(feeName);
	} else {
		return provider(feeName);
	}
}

function sendTransaction (options) {
	//Required
	if (options == null || typeof options !== 'object') throw "Options must be specified and must be an object.";
	if (options.from == null) throw "Must specify from address.";
	if (options.to == null) throw "Must specify to address.";
	if (options.btc == null) throw "Must specify amount of btc to send.";
	if (options.privKeyWIP == null) throw "Must specify the wallet's private key in WIP format.";

	//Optionals
	if (options.network == null) options.network = 'mainnet';
	if (options.fee == null) options.fee = 'fastest';
	if (options.confirmations == null) options.confirmations = 6;
	if (options.feesProvider == null) options.feesProvider = providers.fees[options.network].default;
	if (options.utxoProvider == null) options.utxoProvider = providers.utxo[options.network].default;
	if (options.pushtxProvider == null) options.pushtxProvider = providers.pushtx[options.network].default;

	var from = options.from;
	var to = options.to;
	var amount = options.btc;
	var amtSatoshi = Math.floor(amount*Math.pow(10, BITCOIN_DIGITS));

	return Promise.all([
		getFees(options.feesProvider, options.fee),
		options.utxoProvider(from)
	]).then(function (res) {
		var feePerByte = res[0];
		var utxos = res[1];

		var tx = new bitcoin.TransactionBuilder();
		var ninputs = 0;
		var availableSat = 0;
		for (var i = 0; i < utxos.length; i++) {
			var utxo = utxos[i];
			if (utxo.confirmations >= 6) {
				tx.addInput(utxo.txid, utxo.vout);
				availableSat += utxo.satoshis;
				ninputs++;

				if (availableSat >= amtSatoshi) break;
			}
		}
		var change = availableSat - amtSatoshi;
		var fee = getTransactionSize(ninputs, change > 0 ? 2 : 1)*feePerByte;
		tx.addOutput(to, amtSatoshi - fee);
		if (change > 0) tx.addOutput(from, change);
		var keyPair = bitcoin.ECPair.fromWIF(options.privKeyWIP);
		for (var i = 0; i < ninputs; i++) {
			tx.sign(i, keyPair);
		}
		var msg = tx.build().toHex();
		return options.pushtxProvider(msg);
	});
}

module.exports = {
	providers: providers,
	sendTransaction: sendTransaction
}