#!/usr/bin/env node

require('dotenv').config();

var S = require('string');
var Masto = require('mastodon-api');
var Twitter = require('twitter');
var ChildProcess = require('child_process');
var HTTPS = require('https');
var FS = require('fs');

const Tw = new Twitter({
    consumer_key:        process.env.TWITTER_CONSUMER_KEY,
    consumer_secret:     process.env.TWITTER_CONSUMER_SECRET,
    access_token_key:    process.env.TWITTER_ACCESS_TOKEN_KEY,
    access_token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
});

const M = new Masto({
    access_token: process.env.MASTODON_ACCESS_TOKEN,
    timeout_ms:   60 * 1000,
    api_url:      process.env.MASTODON_API_URL,
});

//const streamPublic = M.stream('streaming/public');
const streamUser = M.stream('streaming/user');

var posted_tweet_ids = {};

function tweet(toot_id, arg)
{
    Tw.post('statuses/update', arg, (error, tweet, response) => {
        if (!error) {
            console.log("Tweeted as T:" + tweet.id_str);
            posted_tweet_ids[toot_id] = tweet.id_str;
        } else {
            console.log(error);
        }
    });
}

function toot(tweet_id, arg)
{
    M.post('statuses', arg, (error, data, response) => {
        if (!error) {
            console.log("Tooted as M:" + data.id);
            if (tweet_id) {
                posted_tweet_ids[data.id] = tweet_id;
            }
        } else {
            console.log(error);
        }
    });
}

streamUser.on('message', (msg) => {
    //console.log(msg);
    if (msg.event == 'update') {
        if (msg.data.account.id == process.env.MASTODON_MY_ACCOUNT_ID &&
            msg.data.visibility == 'public' &&
            msg.data.sensitive == false &&
            msg.data.in_reply_to_id == null
        ) {
            console.log(msg);

            var toot_id = msg.data.id;
            console.log("[update] M:" + toot_id);

            if (posted_tweet_ids[toot_id] != null) {
                console.log('M:' + toot_id + ' has already tweeted, skip');
                return;
            }

            var content = null;
            var media = null;

            if (msg.data.reblog == null) {
                // 通常Toot
                content = S(msg.data.content)
                    .replaceAll('</p>', "\n\n")
                    .replaceAll('<br>', "\n")
                    .replaceAll('<br />', "\n")
                    .stripTags()
                    .unescapeHTML()
                    .s;
                if (msg.data.media_attachments.length > 0) {
                    media = msg.data.media_attachments.shift();
                }
            } else {
                // Boost
                // 自分のBoostはstreaming/publicには流れてこないみたい(2017/10/29)
                if (msg.data.reblog.visibility == 'public' &&
                    msg.data.reblog.sensitive == false &&
                    msg.data.reblog.in_reply_to_id == null
                ) {
                    content = msg.data.reblog.url;
                }
            }

            if (content != null) {
                console.log("Trying to tweet: " + content);

                if (media != null) {
                    console.log("attached media: type=" + media.type + ", url=" + media.url);
                    HTTPS.get(media.url, (res) => {
                        var data = [];
                        res.on('data', (chunk) => {
                            data.push(chunk);
                        });
                        res.on('end', () => {
                            var buf = Buffer.concat(data);
                            var size = Buffer.byteLength(buf);
                            console.log("size = " + size);
                            if (media.type == 'video') {
                                console.log("try chunked media upload for video");
                                // --- begin INIT
                                console.log("INIT");
                                Tw.post('media/upload', {
                                    command: 'INIT',
                                    total_bytes: size,
                                    media_type: 'video/mp4'
                                }, (error, data_init, response) => {
                                    if (!error) {
                                        // --- begin APPEND
                                        console.log("APPEND");
                                        Tw.post('media/upload', {
                                            command: 'APPEND',
                                            media_id: data_init.media_id_string,
                                            media: buf,
                                            segment_index: 0
                                        }, (error, data_append, response) => {
                                            if (!error) {
                                                // --- begin FINALIZE
                                                console.log("FINALIZE");
                                                Tw.post('media/upload', {
                                                    command: 'FINALIZE',
                                                    media_id: data_init.media_id_string
                                                }, (error, data_append, response) => {
                                                    if (!error) {
                                                        tweet(toot_id, { status: content, media_ids: data_init.media_id_string });
                                                    } else {
                                                        console.log("error on FINALIZE");
                                                        console.log(error);
                                                    }
                                                });
                                                // --- end FINALIZE
                                            } else {
                                                console.log("error on APPEND");
                                                console.log(error);
                                            }
                                        });
                                        // --- end APPEND
                                    } else {
                                        console.log("error on INIT");
                                        console.log(error);
                                    }
                                });
                                // --- end INIT
                            } else {
                                console.log("try simple media upload for image");
                                Tw.post('media/upload', { media: buf }, (error, m, response) => {
                                    if (!error) {
                                        tweet(toot_id, { status: content, media_ids: m.media_id_string });
                                    } else {
                                        console.log(error);
                                    }
                                });
                            } 
                        });
                    });
                } else {
                    tweet(toot_id, { status: content });
                }
            }
        } else if (msg.data.account.id == process.env.MASTODON_MY_ACCOUNT_ID &&
            msg.data.visibility == 'direct' &&
            msg.data.sensitive == false &&
            msg.data.in_reply_to_id == null
        ) {
            console.log(msg);

            var query = S(msg.data.content)
                .replaceAll('<br>', "\n")
                .replaceAll('<br />', "\n")
                .stripTags()
                .unescapeHTML()
                .s;

            FS.writeFile('./tmp/moyasearch_query.txt', query, 'utf8', (err) => {
                if (!err) {
                    ChildProcess.exec('./bin/moyasearch.pl "' + query + '"', (error, stdout, stderr) => {
                        if (error) {
                            console.log(error);
                        } else {
                            var result = stdout;
        
                            if (stdout != '' && stdout != null) {
                                result = result + ' #moyasearch';
                                console.log("Trying to toot: " + result);
                                toot(null, { status: result });
                            }
                        }
                    });
                 }
            });
        }
    } else if (msg.event == 'delete') {
        console.log(msg);
        var toot_id = msg.data;
        console.log("[delete] M:" + toot_id);
        if (posted_tweet_ids.hasOwnProperty(toot_id)) {
            var tweet_id = posted_tweet_ids[toot_id];
            console.log("Trying to destroy T:" + tweet_id);
            Tw.post('statuses/destroy/' + tweet_id, { trim_user: 1 }, (error, tweet, response) => {
                if (!error) {
                    console.log("Destroyed T:" + tweet.id_str);
                }
            });
        }
    }
});
streamUser.on('error', (err) => {
    console.log("[error] " + err);
});


