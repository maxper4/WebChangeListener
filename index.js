const fs = require('fs');
const puppeteer = require('puppeteer');
const { parse } = require('node-html-parser');
const URL = require('url').URL;
const ipc = require('node-ipc');	   

const version = '1.0.0';
const saveFolder = __dirname + '/Saves/';
const BOT_ID = 'web-change-listener';

const connectToContactor = () => {
    ipc.config.id = BOT_ID;
    ipc.config.retry = 1500;
    ipc.config.silent = true;
    ipc.connectToNet('contactor', () => {
        ipc.of.contactor.on('connect', () => {
            console.log('Connected to contactor');
        });
    });
};

const onDetectChange = (page) => {
    ipc.of.contactor.emit('alert', JSON.stringify({ id: BOT_ID, message: "[WebChangeListener] - Change detected on: " + page}));
    console.log('change detected on: ' + page);
}

const getLinks = async(page, visited, hostname) => {
    let links = await page.$$eval('a', as => as.map(a => a.href));

    const mainUrl = page.url();
    links = links.map(link => new URL(link, mainUrl));

    return links.filter(link => { 
        return link.hostname == hostname && !visited.has(link.toString());
    });
}

const exploreWebsite = async(page, url, visited, hostname, pagesExcludedFromCheck = [], selectorsExcludedFromCheck = {}) => {
    if (visited.has(url.toString())) {
        return 0;
    }

    visited.add(url.toString());

    try {
        await page.goto(url, {
            waitUntil: 'networkidle0', 
        });
    }
    catch (e) {
        return 0;
    }

    //load previously saved page
	const content = await page.content();
    const filename = saveFolder + url.hostname + '/' + (url.pathname != "/" ? url.pathname : "index") + '.html';

    let differentCount = 0;

    if(!pagesExcludedFromCheck.includes(url.toString())) {
        if (fs.existsSync(filename)) {
            const oldContent = await fs.readFileSync(filename, 'utf8');

            if (oldContent != content) {
                const root = parse(content);
                const oldRoot = parse(oldContent);

                if(url.toString() in selectorsExcludedFromCheck) {
                    selectorsExcludedFromCheck[url.toString()].forEach(selector => {
                        root.querySelectorAll(selector).forEach(x=> x.remove());
                        oldRoot.querySelectorAll(selector).forEach(x=> x.remove());
                    });
                }

                if(root.toString() != oldRoot.toString()) {
                    await onDetectChange(url);
                    differentCount++;
                }
            }
        }
        else {
            try {
                fs.mkdirSync(saveFolder + url.hostname + '/', { recursive: true } );
            } catch (e) {
                console.log('Cannot create folder ', e);
            }
        }

        //save page
        await fs.writeFile(filename, content, (err) => {
            if (err) throw err;
        });

    }

    const links = await getLinks(page, visited, hostname);
    for (const link of links) {
        const subDifferent = await exploreWebsite(page, link, visited, hostname, pagesExcludedFromCheck, selectorsExcludedFromCheck);
        differentCount += subDifferent;
    }

    return differentCount;
}

const scrap = async (browser, targetUrl, pagesExcludedFromCheck, selectorsExcludedFromCheck) => {
    const links = new Set();

    const timeStart = Date.now();
    console.log('Scraping started on: ' + targetUrl.toString());

    //create a new in headless chrome 
	const page = await browser.newPage(); 

    const countDifferent = await exploreWebsite(page, targetUrl, links, targetUrl.hostname, pagesExcludedFromCheck, selectorsExcludedFromCheck);

    await page.close();

    console.log('Scraping finished on: ' + targetUrl.toString() + " in " + (Date.now() - timeStart) + "ms - " + links.size + " pages visited / " + countDifferent + " pages changed");
}

(async () => { 
    let args = process.argv;
    if(args.length == 3 && args[2] == "--version") {
        console.log(version);
        process.exit(0);
    }
    else if(args.length >= 3) {
        require('log-timestamp');

        const targetUrl = new URL(args[2]);
        let interval = 0;
        if(args.length > 3 && args[3].startsWith("--interval=")) {
            args[3] = args[3].substring("--interval=".length);
            interval = parseInt(args[3]);
        }

        const pagesExcludedFromCheck = [];
        const selectorsExcludedFromCheck = {};

        for(let i = 0; i < args.length; i++) {
            if(args[i].startsWith("--exclude-page=")) {
                pagesExcludedFromCheck.push(args[i].substring("--exclude-page=".length));
            }
            else if(args[i].startsWith("--exclude-selector=")) {
                const url = new URL(args[i].substring("--exclude-selector=".length));
                if(!(url.toString() in selectorsExcludedFromCheck)) {
                    selectorsExcludedFromCheck[url.toString()] = [];
                }
                selectorsExcludedFromCheck[url.toString()].push(args[i+1]);
                i++;
            }
        }

        connectToContactor();
        
        console.log("Scraping " + targetUrl.toString() + (interval == 0 ? " once:" : " every " + interval + "ms:"));
        console.log("Excluded pages: " + pagesExcludedFromCheck);
        let selectorsExcludedFromCheckString = "";
        for(let url in selectorsExcludedFromCheck) {
            selectorsExcludedFromCheckString += url + ": " + selectorsExcludedFromCheck[url].join(", ") + " ";
        }
        console.log("Excluded selectors: " + selectorsExcludedFromCheckString);

        //initiate the browser 
        const browser = await puppeteer.launch({
            userDataDir: './data',
        }); 

        if(interval == 0) {
            await scrap(browser, targetUrl, pagesExcludedFromCheck, selectorsExcludedFromCheck);
            await browser.close();
            process.exit(0);
        }
        else {
            await scrap(browser, targetUrl, pagesExcludedFromCheck, selectorsExcludedFromCheck);
            setInterval(async () => {
                await scrap(browser, targetUrl, pagesExcludedFromCheck, selectorsExcludedFromCheck);
            }
            , interval);
        }
    }
    else {
        console.log("Usage: node index.js <url> [--interval=<interval>] [--exclude-page=<url>] [--exclude-selector=<url> <selector>]");
        console.log("Example: node index.js https://www.ethcc.io/ --interval=60000 --exclude-page=https://www.ethcc.io/ --exclude-selector=https://www.ethcc.io/ .css-gu522k --exclude-selector=https://www.ethcc.io/ 'head > script' --exclude-selector=https://www.ethcc.io/ '.css-j5sp9m .gm-style > div'");
        process.exit(1);
    }
})();