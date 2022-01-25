const { Telegram } = require('./telegram');
const israeliBankScrapers = require('israeli-bank-scrapers');
const mysql = require('mysql');
const { JsonDB } = require('node-json-db');
const moment = require('moment');
const puppeteer = require('puppeteer');
const yargs = require('yargs');
const { Utils } = require('./utils');
const { KeyVaultUtils } = require('./keyvaultutils');
const consts = require('./consts');
const { EnvParams } = require('./envparams');

class IsraelFinanceTelegramBot {
  constructor(keyVaultClient, telegramToken, telegramChatId, envParams, isDocker) {
    this.keyVaultClient = keyVaultClient;
    this.envParams = envParams;
    this.handledTransactionsDb = new JsonDB(envParams.handledTransactionsDbPath, true, false);
    this.flaggedTransactionsDb = new JsonDB(envParams.flaggedTransactionsDbPath, true, true);
    this.telegram = new Telegram(this.flaggedTransactionsDb, telegramToken, telegramChatId);
    this.isDocker = isDocker;
    this.setPeriodicRun();
  }

  setPeriodicRun() {
    setInterval(this.run.bind(this), this.envParams.intervalSeconds * 1000);
  }

  createConnection() {
    const dbConnection = mysql.createConnection({
      host: this.envParams.DBHost,
      user: this.envParams.DBUser,
      password: this.envParams.DBPass,
      database: this.envParams.DBName,
    });
    dbConnection.connect();
    return dbConnection;
  }

  closeConnection(dbConnection) {
    return dbConnection.close();
  }

  insertTransaction(transaction, account, company) {
    const connection = this.createConnection();
    const date = transaction.date.substring(0, 10);
    const year = transaction.date.substring(0, 4);
    const month = transaction.date.substring(5, 7);
    const identifier = typeof transaction.identifier === 'undefined' ? '000' : transaction.identifier;
    const processedDate = transaction.processedDate.substring(0, 10);
    const sql = `INSERT INTO expenses (type, identifier ,year, month, date, processed_date, original_amount, original_currency, charged_amount,description,status,memo, account, company) VALUES ('${transaction.type}',${identifier},${year},${month},'${date}','${processedDate}','${transaction.originalAmount}','${transaction.originalCurrency}',${transaction.chargedAmount},'${transaction.description.replace(/'/g, '')}','${transaction.status}', '${transaction.memo}', '${account}','${company}') ON DUPLICATE KEY UPDATE status='${transaction.status}',charged_amount=${transaction.chargedAmount};`;
    console.log(sql);
    connection.query(sql, (err, result) => {
      if (err) throw err;
    });
  }

  getRules(callback) {
    const connection = this.createConnection();
    const query = 'SELECT * FROM rules';
    connection.query(query, (error, results) => {
      if (error) throw error;
      return callback(results);
    });
  }

  applyRules() {
    this.getRules((rules) => {
      const connection = this.createConnection();
      rules.forEach((rule) => {
        console.log(rule);
        // eslint-disable-next-line eqeqeq
        let sql = `UPDATE expenses SET category_id = ${rule.category_id}, calculated=1 WHERE description LIKE '%${rule.text}%' AND category_id IS NULL`;
        // eslint-disable-next-line eqeqeq
        if (rule.operator != null) {
          sql = `UPDATE expenses SET category_id = ${rule.category_id}, calculated=1 WHERE (description LIKE '%${rule.text}%' ${rule.operator} charged_amount = '${rule.amount}') AND category_id IS NULL`;
        }
        console.log(sql);
        connection.query(sql, (err, result) => {
          if (err) throw err;
        });
      });
    });
  }

  static getMessageFromTransaction(transaction, cardNumber, serviceNiceName) {
    let transactionName = 'זיכוי';
    let amount = transaction.chargedAmount;
    if (amount < 0) {
      transactionName = 'חיוב';
      amount *= -1;
    }
    const dateStr = new Date(transaction.date).toLocaleDateString('he-IL');
    let currency = transaction.originalCurrency;
    switch (currency) {
      case 'ILS':
        currency = '₪';
        break;
      case 'USD':
        currency = '$';
        break;
      default:
        break;
    }
    let status = `בסטטוס ${transaction.status} `;
    if (transaction.status === 'completed') {
      status = '';
    }
    let type = `(מסוג ${transaction.type}) `;
    if (transaction.type === 'normal') {
      type = '';
    }
    return `${serviceNiceName}: ${transactionName} - ${transaction.description} על סך ${amount}${currency} בתאריך ${dateStr} ${status}${type}בחשבון ${cardNumber}`;
  }

  messageSent(handledTransactionsDbPath, telegramMessageId) {
    this.handledTransactionsDb.push(
      handledTransactionsDbPath,
      { sent: true, telegramMessageId },
      false,
    );
  }

  handleAccount(service, account) {
    account.txns.sort(Utils.transactionCompare);
    account.txns.forEach((transaction) => {
      // Read https://github.com/GuyLewin/israel-finance-telegram-bot/issues/1 - transaction.identifier isn't unique
      // This is as unique as we can get
      const identifier = `${transaction.date}-${transaction.chargedAmount}-${transaction.identifier}`;
      const handledTransactionsDbPath = `/${service.companyId}/${identifier}`;
      if (this.handledTransactionsDb.exists(handledTransactionsDbPath)) {
        const telegramMessageId = this.handledTransactionsDb.getData(`${handledTransactionsDbPath}/telegramMessageId`);
        if (!(this.flaggedTransactionsDb.exists(`/${telegramMessageId}`))) {
          this.telegram.registerReplyListener(telegramMessageId, transaction);
        }
        this.existingTransactionsFound += 1;
        if (this.envParams.isVerbose) {
          console.log(`Found existing transaction: ${handledTransactionsDbPath}`);
        }
        return;
      }
      this.newTransactionsFound += 1;
      if (this.envParams.isVerbose) {
        console.log(`Found new transaction: ${handledTransactionsDbPath}`);
      }
      this.insertTransaction(transaction, account.accountNumber, service.companyId);
      const message = IsraelFinanceTelegramBot.getMessageFromTransaction(
        transaction,
        account.accountNumber,
        service.niceName,
      );
      this.telegram.sendMessage(
        message,
        this.messageSent.bind(this, handledTransactionsDbPath),
        transaction,
      );
    });
    this.applyRules();
  }

  startRunStatistics() {
    const curDate = (new Date()).toLocaleString();
    console.log(`Starting periodic run on ${curDate}`);

    this.existingTransactionsFound = 0;
    this.newTransactionsFound = 0;
  }

  handleMessage(msg, callback) {
    this.prepareRepsonse(msg, (responseMessage) => {
      return callback(responseMessage);
    });
  }

  async prepareRepsonse(msg, callback) {
    const connection = this.createConnection();
    const query = this.buildQuery(msg);
    connection.query(query, (error, results) => {
      if (error) throw error;
      return callback(results[0].name);
    });
  }

  buildQuery(msg) {
    return 'SELECT * FROM expenses';
  }

  endRunStatistics() {
    const curDate = (new Date()).toLocaleString();
    console.log(`Periodic run ended on ${curDate}. ${this.existingTransactionsFound} existing transactions found, ${this.newTransactionsFound} new transactions found`);
  }

  async getCredentialsForService(service) {
    if (service.credentials) {
      // Allow defining credentials within services JSON (without Azure KeyVault)
      return service.credentials;
    }

    if (!this.keyVaultClient) {
      throw new Error('no KeyVault configured, no credentials in service JSON');
    }

    return KeyVaultUtils.getSecret(this.keyVaultClient, service.credentialsIdentifier)
      .then(credentialsJson => JSON.parse(credentialsJson));
  }

  async handleService(service) {
    if (this.envParams.isVerbose) {
      console.log(`Starting to scrape service: ${JSON.stringify(service)}`);
    }
    const options = Object.assign({ companyId: service.companyId }, {
      verbose: this.envParams.isVerbose,
      startDate: moment()
        .startOf('month')
        .subtract(this.envParams.monthsToScanBack, 'month'),
    });
    if (this.isDocker) {
      options.browser = await puppeteer.launch({
        executablePath: '/usr/bin/chromium-browser',
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
      });
    }
    const scraper = israeliBankScrapers.createScraper(options);
    const credentials = await this.getCredentialsForService(service);
    const scrapeResult = await scraper.scrape(credentials);

    if (scrapeResult.success) {
      scrapeResult.accounts.forEach(this.handleAccount.bind(this, service));
    } else {
      console.error(`scraping failed for the following reason: ${scrapeResult.errorType}`);
    }
  }

  async run() {
    try {
      this.startRunStatistics();
      const services = this.envParams.servicesJson;
      // eslint-disable-next-line no-restricted-syntax
      for (const service of services) {
        // Block each request separately
        await this.handleService(service);
      }
    } catch (e) {
      console.log('Got an error. Will try running again next interval. Error details:');
      console.error(e, e.stack);
    } finally {
      this.endRunStatistics();
    }
  }
}

async function main() {
  let envParams;
  try {
    envParams = new EnvParams();
  } catch (e) {
    console.log('Got error while parsing environment variables');
    // Don't print the stack trace in this case
    console.error(e);
    EnvParams.printUsage();
    process.exit(1);
  }

  let keyVaultClient;
  let telegramToken;
  let telegramChatId;
  if (envParams.keyVaultUrl) {
    keyVaultClient = KeyVaultUtils.getClient(envParams.keyVaultUrl);
    telegramToken = await KeyVaultUtils.getSecret(
      keyVaultClient,
      consts.TELEGRAM_TOKEN_SECRET_NAME,
    );
    telegramChatId = await KeyVaultUtils.getSecret(
      keyVaultClient,
      consts.TELEGRAM_CHAT_ID_SECRET_NAME,
    );
  } else {
    ({ telegramToken, telegramChatId } = envParams);
  }

  try {
    const iftb = new IsraelFinanceTelegramBot(
      keyVaultClient,
      telegramToken,
      telegramChatId,
      envParams,
      yargs.argv.docker === true,
    );

    iftb.telegram.bot.on('message', (msg) => {
      const chatId = msg.chat.id;
      iftb.handleMessage(msg, (response) => {
        iftb.telegram.bot.sendMessage(chatId, response);
      });
    });
    
    iftb.run();
  } catch (e) {
    console.log(`Error in main(): ${e}`);
  }
}

main();
