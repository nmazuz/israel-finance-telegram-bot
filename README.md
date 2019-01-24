# israel-finance-telegram-bot
Telegram bot that scrapes and sends notifications about bank and credit card charges. This tool uses [Israeli Banks Scrapers](https://github.com/eshaham/israeli-bank-scrapers) project as the source of fetching account data.

## Getting started

### Prerequisites 

In order to start using this tool, you will need to have Node.js (>= 8) installed on your machine.  
Go [here!](https://nodejs.org/en/download/) to download and install the latest Node.js for your operating system.

### Installation
Once Node.js is installed, run the following command to fetch the code:

```bash
git clone https://github.com/GuyLewin/israel-finance-telegram-bot
cd israel-finance-telegram-bot
```

If you're using `nvm` make sure to run `nvm use` inside project folder for best compatability.
If you're using `nodenv`, it should automatically pick up the correct node version.

Next you will need to install dependencies by running
```bash
npm install
```
### Configuration
This tool relies on having the account data for scraping the finnancial accounts. As you can read from the code, it's not sent anywhere and is only saved in your local configuration file. You shouldn't upload this file anywhere or let it leave your computer.
In order to create such configuration file, create a copy of `config.js.template` from the root directory named `config.js`.

#### Accounts Configuration
Modify the accounts according to the template.
For more information about specific configurations for the different services, visit the [Israeli Banks Scrapers](https://github.com/eshaham/israeli-bank-scrapers) project's README.

#### Telegram API Key
This script uses Telegram as the framework for notifying users for new transactions and interacting with the user in general.
The script has to have an API key in order to authenticate as a Telegram bot.
Follow [this guide](https://docs.influxdata.com/kapacitor/v1.5/event_handlers/telegram/#create-a-telegram-bot) to create a new Telegram bot (the name and username of the bot don't matter), and copy the generated API key to `CONFIG.TELEGRAM_TOKEN` in `config.js`.

#### Telegram Chat ID
The bot only interacts with one Telegram user - your account. Therefore you must configure the chatId of the chat between your bot and your personal account. To do so, follow [this guide](https://docs.influxdata.com/kapacitor/v1.5/event_handlers/telegram/#get-your-telegram-chat-id) to get the chat id.
Once you got it, replace `CONFIG.TELEGRAM_CHAT_ID` in `config.js` to that value.

## Running the Code
Now that everything is ready, simply run the following command to start the bot.
```bash
./node_modules/.bin/babel-node src/index.js
```
The bot should initially send notifications for all transactions since the beginning of last month (or the start date configured in `config.js`).
Afterwards, it will only send notifications for new transactions.

## Bot Interactiveness
Currently the bot supports only supports one interactive command - "לא".

### לא command
You may reply to a message the bot sent you (you have to use the Telegram 'reply' feature and include the original message, by long pressing the message and choosing 'Reply'), and write the text "לא".
The bot will then insert the transaction details into a JSON file called `transactionsToGoThrough.json`.
This feature was written to help retroactively-verify transactions you're not sure about. 

Feel free to open Pull Requests with more features / contact me if you have feature ideas.