const express = require("express");
const route = express.Router();
const bodyParser = require("body-parser");

const logger = require("../../middleware/log");
const db_con = require("../../utils/database_con");

const fs = require("fs");

const cdn_upload = require("../../utils/cdn_upload");
const moment = require("moment");
const multer = require("multer");
const ejs = require("ejs");
const disallow_guest = require("../../middleware/disallow_guest");

route.post("/", bodyParser.json({ limit: "5mb" }), async (req, res) => {
    const community_id = req.body.community_id;
    const feeling_id = req.body.feeling_id;
    const spoiler = req.body.spoiler;
    const title_owned = req.body.owns_title;

    const topic_tag = req.body.topic_tag;
    const body = req.body.body;
    const screenshot = req.body.screenshot;
    const screenshot_MIME = req.body.screenshot_MIME;
    var platform;

    if (
        title_owned == undefined ||
        spoiler == undefined ||
        feeling_id == undefined ||
        community_id == undefined
    ) {
        logger.error(
            `No title_owned, spoiler, feeling_id, or community_id from ${res.locals.user.username}`
        );
        res.status(400).send({ success: false, error: "MISSING_VALUES" });
        return;
    }
    if (!body) {
        logger.error(`No body from ${res.locals.user.username}`);
        res.status(400).send({ success: false, error: "NO_BODY_OR_PAINTING" });
        return;
    }
    if (screenshot && !screenshot_MIME) {
        logger.error(`No screenshot MIME from ${res.locals.user.username}`);
        res.status(400).send({ success: false, error: "INVALID_SCREENSHOT" });
        return;
    }

    const community = (
        await db_con.env_db("communities").where({ id: community_id })
    )[0];

    if (community.post_type == "text" && painting) {
        res.status(400).send({ success: false, error: "TEXT_ONLY" });
        logger.error("Text only community!");
        return;
    }
    if (community.post_type == "memo" && body) {
        res.status(400).send({ success: false, error: "PAINTING_ONLY" });
        logger.error("Memo only community!");
        return;
    }
    if (community.type == "announcement" && res.locals.user.admin == 0) {
        res.status(400).send({
            success: false,
            error: "ANNOUNCEMENT_COMMUNITY",
        });
        logger.error(
            `${res.locals.user.username} tried to post to ${community.name}`
        );
        return;
    }

    platform = "web";

    const insert_data = {
        account_id: res.locals.user.id,

        feeling_id: feeling_id,
        community_id: community_id,
        spoiler: spoiler,

        is_autopost: 0,
        is_app_jumpable: 0,

        posted_from: platform,
    };

    if (body) {
        insert_data.body = body;
    } else {
        insert_data.painting = painting;
    }
    if (screenshot) {
        insert_data.screenshot = screenshot;
    }
    if (topic_tag) {
        insert_data.topic_tag = topic_tag;
    }

    //Checking for last post's content, to avoid spam.
    const last_post_content = (
        await db_con
            .env_db("posts")
            .where({ account_id: res.locals.user.id })
            .whereBetween("create_time", [
                moment().subtract(10, "minutes").format("YYYY-MM-DD HH:mm:ss"),
                moment().add(10, "minutes").format("YYYY-MM-DD HH:mm:ss"),
            ])
            .orderBy("create_time", "desc")
            .limit(1)
    )[0];

    //Yes I know this is a bad if statement. will come back to it when I can.
    if (last_post_content) {
        if (body && last_post_content.body) {
            if (
                last_post_content.body.replace(" ", "") == body.replace(" ", "")
            ) {
                res.status(400).send({
                    success: false,
                    error: "SPAM_DETECTED",
                });
                return;
            }
        }
    }

    const post_id = (await db_con.env_db("posts").insert(insert_data))[0];

    logger.info(`${res.locals.user.username} posted to ${community.name}`);

    if (screenshot) {
        fs.writeFileSync(
            __dirname +
                `/../../../CDN_Files/img/screenshots/${post_id}.${
                    screenshot_MIME.split("/")[1]
                }`,
            screenshot,
            "base64"
        );
        const screenshot_result = await cdn_upload.uploadImage(
            __dirname +
                `/../../../CDN_Files/img/screenshots/${post_id}.${
                    screenshot_MIME.split("/")[1]
                }`,
            "screenshots"
        );

        const update_data = {
            screenshot_cdn_url: screenshot_result.secure_url,
        };

        await db_con.env_db("posts").update(update_data).where("id", post_id);
        logger.info(`Saved screenshot.`);
    }

    const post = (await db_con.env_db("posts").where({ id: post_id }))[0];

    post.username = res.locals.user.username;
    post.cdn_profile_normal_image_url =
        res.locals.user.cdn_profile_normal_image_url;
    post.cdn_profile_happy_image_url =
        res.locals.user.cdn_profile_happy_image_url;
    post.cdn_profile_like_image_url =
        res.locals.user.cdn_profile_like_image_url;
    post.cdn_profile_surprised_image_url =
        res.locals.user.cdn_profile_surprised_image_url;
    post.cdn_profile_frustrated_image_url =
        res.locals.user.cdn_profile_frustrated_image_url;
    post.cdn_profile_puzzled_image_url =
        res.locals.user.cdn_profile_puzzled_image_url;
    post.mii_name = res.locals.user.mii_name;
    post.account_id = res.locals.user.id;
    post.empathy_count = 0;
    post.reply_count = 0;

    const locals = {
        moment: res.locals.moment,
        user: res.locals.user,
    };

    const html = await ejs.renderFile(
        __dirname + "/../../views/partials/elements/ugc/posts.ejs",
        {
            post: post,
            locals: locals,
            show_community: false,
        }
    );

    res.status(201).send({ success: true, post_id: post_id, html: html });
});

route.post("/:post_id/empathy", disallow_guest, async (req, res) => {
    const post = (
        await db_con.env_db("posts").where({ id: req.params.post_id })
    )[0];
    if (!post) {
        res.status(404).send({ success: false, error: "NULL_POST" });
        return;
    }

    const current_empathy = (
        await db_con.env_db("empathies").where({
            post_id: req.params.post_id,
            account_id: res.locals.user.id,
        })
    )[0];

    if (current_empathy) {
        //Deleting the current empathy
        await db_con
            .env_db("empathies")
            .where({
                post_id: req.params.post_id,
                account_id: res.locals.user.id,
            })
            .delete();

        res.status(200).send({ success: true, empathy_status: "DELETED" });
    } else {
        //Creating a new empathy
        await db_con.env_db("empathies").insert({
            post_id: req.params.post_id,
            account_id: res.locals.user.id,
        });

        res.status(201).send({ success: true, empathy_status: "CREATED" });
    }
});

module.exports = route;
