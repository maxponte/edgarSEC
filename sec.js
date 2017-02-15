var request = require('request');
var parser = require('xml2json');
var async = require('async');
var fs = require('fs');
var os = require('os');

const bridgewaterCIK = '0001350694';
const waitPeriod = 10000; // how long to wait b/w 13F requests, don't want to get rate limited
const downloadDirectory = `${os.homedir()}/sec`;

function withoutLeadingZeros(str) {
	for (var i = 0; i < str.length && str[i] === '0'; i++);
	return str.slice(i);
}

function withoutDashes(str) {
	return str.replace(/\-/g, '');
}

function urlForFilingByCIKAndAccesionNumber(cikNumberWithLeadingZeros, accessionNumberWithDashes) {
	var cikNumberNoLeadingZeros = withoutLeadingZeros(cikNumberWithLeadingZeros);
	var accessionNumberNoDashes = withoutDashes(accessionNumberWithDashes);
	return `https://www.sec.gov/Archives/edgar/data/${cikNumberNoLeadingZeros}/${accessionNumberNoDashes}/form13fInfoTable.xml`;
}

function urlForFilingsByCIK(cikNumberWithLeadingZeros) {
	return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cikNumberWithLeadingZeros}&CIK=${cikNumberWithLeadingZeros}&type=13F%25&dateb=&owner=exclude&start=0&count=300&output=atom`;
}

function doWithContentFrom(url, action, cb) {
	request({
		url,
		headers: {
			'User-Agent': 'Mozilla/5.0 (Windows; U; Windows NT 5.1; en-US; rv:1.8.1.13) Gecko/20080311 Firefox/2.0.0.13'
		}
	}, function (error, response, body) {
	  if (!error && response.statusCode == 200) {
	    action(body, cb);
	  } else {
	  	const msg = `Reponse had not-OK status code {response.statusCode}` +
	  		`, try downloading it manually from ${url}.`
	  	cb();
	  }
	});
}

function getListOfFilingMetadata(data) {
	const lst = data.feed.entry;
	const result = [];
	lst.forEach(entry => {
		if (entry.category.term.startsWith('13F')) {
			result.push({
				accessionNumberWithDashes: entry.content['accession-nunber'],
				filingDate: entry.content['filing-date'],
				kind: entry.category.term
			});
		}
	});	
	return result;
}

function processFiling(cikNumberWithLeadingZeros, { accessionNumberWithDashes, filingDate, kind }, cb) {
	const url = urlForFilingByCIKAndAccesionNumber(cikNumberWithLeadingZeros, accessionNumberWithDashes);
	doWithContentFrom(
		url,
		(body, cb) => {
			const path = `${downloadDirectory}/${kind}__${filingDate}.xml`;
			fs.writeFile(path, body, err => {
				console.log(`New filing saved to ${path}`);
				if (err) return cb(err);
				return cb();
			});
		},
		err => {
			if (err) return cb(err);
			return cb();
		}
	);
}

function getXMLFilingsByCIK(cikNumberWithLeadingZeros, cb) {
	if (!fs.existsSync(downloadDirectory)) {
		console.log(`Download directory not found. Making directory ${downloadDirectory}.`);
		fs.mkdirSync(downloadDirectory);
	}
	doWithContentFrom(
		urlForFilingsByCIK(cikNumberWithLeadingZeros),
		(body, cb) => {
			// console.log(body);
			// process.exit(0);
			const filingMetadata = getListOfFilingMetadata(JSON.parse(parser.toJson(body)));
			let idx = 0;
			async.whilst(
				() => idx++ < filingMetadata.length,
				cb => {
					const metadata = filingMetadata[idx];
					processFiling(cikNumberWithLeadingZeros, metadata, err => {
						if (err) return cb(err);
						return setTimeout(cb, waitPeriod);
					});
				},
				(err, nSecondsPassed) => {
					if (err) return cb(err);
					console.log(`Finished ingesting ${filingMetadata.length} filings over ${nSecondsPassed} seconds.`)
					return cb();
				}
			);
		},
		cb
	);
}

function main() {
	getXMLFilingsByCIK(bridgewaterCIK, err => {
		if (err) throw err;
	});
}

if (require.main === module) {
	main();
}