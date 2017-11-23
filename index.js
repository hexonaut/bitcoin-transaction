var bitcoin = require('bitcoinjs-lib');
var request = require('superagent');

var BITCOIN_DIGITS = 8;
var BITCOIN_SAT_MULT = Math.pow(10, BITCOIN_DIGITS);

var providers = {
	/**
	 * Input: Address to retrieve the balance from.
	 * Output: The balance in Satoshis.
	 */
	balance: {
		mainnet: {
			blockexplorer: function (addr) {
				return request.get('https://blockexplorer.com/api/addr/' + addr + '/balance').send().then(function (res) {
					return parseFloat(res.body);
				});
			},
			blockchain: function (addr) {
				return request.get('https://blockchain.info/q/addressbalance/' + addr + '?confirmations=6').send().then(function (res) {
					return parseFloat(res.body);
				});
			}
		},
		testnet: {
			blockexplorer: function (addr) {
				return request.get('https://testnet.blockexplorer.com/api/addr/' + addr + '/balance').send().then(function (res) {
					return parseFloat(res.body);
				});
			}
		}
	},
	/**
	 * Input: Requested processing speed. "fastest", "halfHour" or "hour"
	 * Output: Fee rate in Satoshi's per Byte.
	 */
	fees: {
		mainnet: {
			earn: function (feeName) {
				return request.get('https://bitcoinfees.earn.com/api/v1/fees/recommended').send().then(function (res) {
					return res.body[feeName + "Fee"];
				});
			}
		},
		testnet: {
			earn: function (feeName) {
				return request.get('https://bitcoinfees.earn.com/api/v1/fees/recommended').send().then(function (res) {
					return res.body[feeName + "Fee"];
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
				return request.get('https://blockexplorer.com/api/addr/' + addr + '/utxo?noCache=1').send().then(function (res) {
					return res.body.map(function (e) {
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
				return request.get('https://blockchain.info/unspent?active=' + addr).send().then(function (res) {
					return res.body.unspent_outputs.map(function (e) {
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
				return request.get('https://testnet.blockexplorer.com/api/addr/' + addr + '/utxo?noCache=1').send().then(function (res) {
					return res.body.map(function (e) {
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
				return request.post('https://blockexplorer.com/api/tx/send').send('rawtx: ' + hexTrans);
			},
			blockchain: function (hexTrans) {
				return request.post('https://blockchain.info/pushtx').send('tx=' + hexTrans);
			}
		},
		testnet: {
			blockexplorer: function (hexTrans) {
				return request.post('https://testnet.blockexplorer.com/api/tx/send').send('rawtx: ' + hexTrans);
			},
			blockcypher: function (hexTrans) {
				return request.post('https://api.blockcypher.com/v1/btc/test3/txs/push').send('{"tx":"' + hexTrans + '"}');
			}
		}
	}
}

//Set default providers
providers.balance.mainnet.default = providers.balance.mainnet.blockexplorer;
providers.balance.testnet.default = providers.balance.testnet.blockexplorer;
providers.fees.mainnet.default = providers.fees.mainnet.earn;
providers.fees.testnet.default = providers.fees.testnet.earn;
providers.utxo.mainnet.default = providers.utxo.mainnet.blockexplorer;
providers.utxo.testnet.default = providers.utxo.testnet.blockexplorer;
providers.pushtx.mainnet.default = providers.pushtx.mainnet.blockchain;
providers.pushtx.testnet.default = providers.pushtx.testnet.blockcypher;

function getBalance (addr, options) {
	if (options == null) options = {};
	if (options.network == null) options.network = "mainnet";
	if (options.balanceProvider == null) options.balanceProvider = providers.balance[options.network].default;

	return options.balanceProvider(addr).then(function (balSat) {
		return balSat/BITCOIN_SAT_MULT;
	});
}

function getTransactionSize (numInputs, numOutputs) {
	return numInputs*180 + numOutputs*34 + 10 + numInputs;
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
	if (options.privKeyWIF == null) throw "Must specify the wallet's private key in WIF format.";

	//Optionals
	if (options.network == null) options.network = 'mainnet';
	if (options.fee == null) options.fee = 'fastest';
	if (options.feesProvider == null) options.feesProvider = providers.fees[options.network].default;
	if (options.utxoProvider == null) options.utxoProvider = providers.utxo[options.network].default;
	if (options.pushtxProvider == null) options.pushtxProvider = providers.pushtx[options.network].default;
	if (options.dryrun == null) options.dryrun = false;

	var from = options.from;
	var to = options.to;
	var amount = options.btc;
	var amtSatoshi = Math.floor(amount*BITCOIN_SAT_MULT);
	var bitcoinNetwork = options.network == "testnet" ? bitcoin.networks.testnet : bitcoin.networks.bitcoin;

	return Promise.all([
		getFees(options.feesProvider, options.fee),
		options.utxoProvider(from)
	]).then(function (res) {
		var feePerByte = res[0];
		var utxos = res[1];

		//Setup inputs from utxos
		var tx = new bitcoin.TransactionBuilder(bitcoinNetwork);
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

		if (availableSat < amtSatoshi) throw "You do not have enough in your wallet to send that much.";

		var change = availableSat - amtSatoshi;
		var fee = getTransactionSize(ninputs, change > 0 ? 2 : 1)*feePerByte;
		if (fee > amtSatoshi) throw "BitCoin amount must be larger than the fee. (Ideally it should be MUCH larger)";
		tx.addOutput(to, amtSatoshi - fee);
		if (change > 0) tx.addOutput(from, change);
		var keyPair = bitcoin.ECPair.fromWIF(options.privKeyWIF, bitcoinNetwork);
		for (var i = 0; i < ninputs; i++) {
			tx.sign(i, keyPair);
		}
		var msg = tx.build().toHex();
		if (options.dryrun) {
			return msg;
		} else {
			return options.pushtxProvider(msg);
		}
	});
}

module.exports = {
	providers: providers,
	getBalance: getBalance,
	sendTransaction: sendTransaction
}