const axios = require("axios").default;
const axiosCookieJarSupport = require("axios-cookiejar-support").default;
const tough = require("tough-cookie");
const fs = require("fs");
const Path = require("path");
const moment = require("moment");
const mkdirp = require("mkdirp");
const { RateLimit } = require("async-sema");
require("dotenv").config()

// install cookie jar
axiosCookieJarSupport(axios);
const cookieJar = new tough.CookieJar();
axios.defaults.jar = cookieJar;
axios.defaults.withCredentials = true;

const LOGIN_URL = "https://home.classdojo.com/api/session";
const FEED_URL = "https://home.classdojo.com/api/storyFeed?includePrivate=true";

const IMAGE_DIR = "images";
const DATE_FORMAT = "YYYY-MM-DD";
const DATETIME_FORMAT = "YYYY-MM-DDThh-mm-ss";
const MAX_FEEDS = 100;
const CONCURRENCY = 15;
const LIMITER = RateLimit(CONCURRENCY);

let feedsProcessed = 0;
let dateCountMap = {};

async function main() {
    try {
        await login();
    } catch (error) {
        console.error("Failed to login to ClassDojo, double check your .env file", error);
        process.exit();
    }

    try {
        await processFeed(FEED_URL);
    } catch (error) {
        console.log("Couldn't get feed", error);
    }
}

async function login() {
    checkEnv("DOJO_EMAIL");
    checkEnv("DOJO_PASSWORD");

    function checkEnv(variable) {
        if (!process.env[variable]) {
            throw new Error(`${variable} not set in the .env file. Please follow the instructions on the README of the project.`);
        }
    }

    return await axios.post(LOGIN_URL, {
        login: process.env.DOJO_EMAIL,
        password: process.env.DOJO_PASSWORD,
        resumeAddClassFlow: false
    });
}

async function getFeed(url) {
    const storyFeed = await axios.get(url);
    return storyFeed.data;
}

async function saveBodyText(item, counterWithinOneDay) {
    const bodyText = item.contents.body;
    const dateStr = moment(item.time).format(DATE_FORMAT);
    const datetimeStr = moment(item.time).format(DATETIME_FORMAT);
    const senderName = item.senderName.replace(" ", "_");
    const filePath = IMAGE_DIR + "/" + dateStr + "/" + datetimeStr + "_post_" + counterWithinOneDay + "_from_" + senderName + ".text";
    const exists = await fileExists(filePath);
    console.log(`file ${filePath} exists = ${exists}`);
    if (!exists) {
        fs.writeFile(filePath, senderName + "\n" + bodyText, (err, data) => {
            if (err) console.log(err);
            else console.log("Saved body text to " + filePath);
        });
    }
}

async function processFeed(url) {
    const feed = await getFeed(url);

    feedsProcessed++;

    i = 0;
    for (const item of feed._items) {
        const time = item.time;
        const date = moment(time).format(DATE_FORMAT);
        await createDirectory(Path.resolve(__dirname, IMAGE_DIR, date));
        if (!dateCountMap[date]) {
            dateCountMap[date] = 0;
        }

        const counterWithinOneDay = dateCountMap[date];
        dateCountMap[date]++;

        const contents = item.contents;

        saveBodyText(item, counterWithinOneDay);

        const attachments = contents.attachments;

        var attachmentCounter = 0;
        for (const attachment of attachments) {
            const url = attachment.path;
            const filename = getFilePath(date, counterWithinOneDay, attachmentCounter,
                url.substring(url.lastIndexOf("/") + 1));
            await LIMITER();
            downloadFileIfNotExists(url, filename, counterWithinOneDay, attachmentCounter);
            attachmentCounter++;
        }
    }

    console.log("-----------------------------------------------------------------------");
    console.log(`finished processing feed, feedsProcessed = ${feedsProcessed} / ${MAX_FEEDS}`);
    console.log("-----------------------------------------------------------------------");
    if (feedsProcessed < MAX_FEEDS && feed._links && feed._links.prev && feed._links.prev.href) {
        const previousLink = feed._links.prev.href;
        console.log(`found previous link ${previousLink}`);

        try {
            await processFeed(previousLink);
        } catch (error) {
            console.error("Couldn't get feed", error);
        }
    }
}

async function createDirectory(path) {
    return new Promise((resolve, reject) => {
        mkdirp.sync(path);
        resolve();
    });
}

async function downloadFileIfNotExists(url, filePath) {
    const exists = await fileExists(filePath);
    console.log(`file ${filePath} exists = ${exists}`);
    if (!exists) {
        try {
            await downloadFile(url, filePath);
        } catch (error) {
            console.error("Failed to download file ", url);
        }
    }
}

async function fileExists(filePath) {
    return new Promise((resolve, reject) => {
        try {
            fs.accessSync(filePath, fs.constants.R_OK | fs.constants.W_OK);
            resolve(true);
        } catch (err) {
            resolve(false);
        }
    });
}

function splitBasenameAndSuffix(str) {
    var base = new String(str).substring(str.lastIndexOf('/') + 1);
    var suffix = "";
    const lastIndexOfPeriod = base.lastIndexOf(".");
    if (lastIndexOfPeriod != -1) {
        suffix = base.substring(lastIndexOfPeriod);
        base = base.substring(0, lastIndexOfPeriod);
    }
    return [base, suffix];
}

function getFilePath(date, counterWithinOneDay, attachmentCounter, filename) {
    const basenameSuffix = splitBasenameAndSuffix(filename);
    const basename = basenameSuffix[0];
    const suffix = basenameSuffix[1];
    filename = date + "_post_" + counterWithinOneDay + "_" + attachmentCounter + "_" + basename.substring(0, 4) + suffix;
    return Path.resolve(__dirname, IMAGE_DIR, date, filename);
}

async function downloadFile(url, filePath) {
    console.log(`about to download ${filePath}...`)
    const writer = fs.createWriteStream(filePath);

    const response = await axios.get(url, {
        responseType: "stream"
    });

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
        writer.on("finish", () => {
            console.log(`finished downloading ${filePath}`);
            resolve();
        })
        writer.on("error", reject)
    });
}

main();
