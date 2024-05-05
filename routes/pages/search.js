const route = require("express").Router();
const db_con = require("../../../shared_config/database_con");

route.get("/", async (req, res) => {
    const query = `%${req.query["q"].toLowerCase()}%`;
    const original_query = req.query["q"];
    const offset = req.query["offset"] || 0;

    if (!query) {
        res.status(404).render("pages/errors/search/no_query.ejs");
        return;
    }

    const searched_accounts = await db_con
        .account_db("accounts")
        .whereLike(db_con.env_db.raw("LOWER(mii_name)"), query)
        .orWhereLike(db_con.env_db.raw("LOWER(nnid)"), query)
        .orderBy("create_time", "desc")
        .limit(5);
    const searched_posts_query = db_con
        .env_db("posts")
        .select(
            "posts.*",
            "accounts.mii_name",
            "accounts.nnid",
            "accounts.mii_hash",
            "accounts.admin",
            "communities.name as community_name",
            "communities.cdn_icon_url",
            "communities.id as community_id",
            db_con.env_db.raw("COUNT(empathies.post_id) as empathy_count")
        )
        .orWhereRaw("LOWER(url) LIKE ?", [query])
        .orWhereRaw("LOWER(topic_tag) LIKE ?", [query])
        .orWhereRaw("LOWER(body) LIKE ?", [query])
        .groupBy("posts.id")
        .innerJoin("account.accounts", "accounts.id", "=", "posts.account_id")
        .innerJoin("communities", "communities.id", "=", "posts.community_id")
        .leftJoin("empathies", "posts.id", "=", "empathies.post_id")
        .orderBy("posts.create_time", "desc");

    if (!res.locals.guest_mode) {
        searched_posts_query.select(
            db_con.env_db.raw(
                `CASE WHEN empathies.account_id = ${res.locals.user.id} THEN TRUE ELSE FALSE END AS empathied_by_user`
            )
        );
    }

    if (offset > 0) {
        searched_posts_query.offset(offset);
    }

    const searched_posts = await searched_posts_query;

    const searched_communities = await db_con
        .env_db("communities")
        .whereLike(db_con.env_db.raw("LOWER(name)"), query)
        .orWhereLike(db_con.env_db.raw("LOWER(description)"), query)
        .orWhereLike(db_con.env_db.raw("LOWER(app_name)"), query)
        .orderBy("create_time", "desc")
        .limit(5);

    res.render("pages/search.ejs", {
        searched_accounts: searched_accounts,
        searched_communities: searched_communities,
        searched_posts: searched_posts,
        original_query: original_query,
    });
});

module.exports = route;