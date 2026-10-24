/**
 * Clean Links: removes tracking junk (utm_source, fbclid, si=...) from links you send.
 */
import { defineCorePlugin } from "..";
import { onSend, outsideCode, rewriteLinks } from "../shared";

/** Removed from every link. */
const ALWAYS = /^(utm_\w+|fbclid|gclid|gclsrc|dclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|igshid|igsh|yclid|twclid|ttclid|_hsenc|_hsmi|mkt_tok|vero_id|oly_anon_id|oly_enc_id|rb_clickid|s_cid|ncid|trk|trkCampaign|sc_campaign|sc_channel|sc_content|sc_medium|sc_outcome|sc_geo|sc_country|spm|share_id|ref_src|ref_url|__s)$/i;

/** Removed only on these sites (elsewhere the same names can mean something). */
const PER_SITE: [RegExp, RegExp][] = [
    [/(^|\.)(youtube\.com|youtu\.be)$/i, /^(si|feature|pp)$/i],
    [/(^|\.)spotify\.com$/i, /^(si|context|nd|utm_\w+)$/i],
    [/(^|\.)(twitter\.com|x\.com)$/i, /^(s|t|ref_src|ref_url)$/i],
    [/(^|\.)instagram\.com$/i, /^(igsh|igshid|utm_\w+)$/i],
    [/(^|\.)tiktok\.com$/i, /^(_r|_t|is_from_webapp|sender_device|sender_web_id|share_app_id|share_link_id|tt_from|u_code|user_id|social_sharing|source|refer|web_id)$/i],
    [/(^|\.)reddit\.com$/i, /^(share_id|utm_\w+|rdt|context)$/i],
    [/(^|\.)amazon\.[a-z.]+$/i, /^(ref|ref_|pf_rd_\w+|pd_rd_\w+|content-id|psc|crid|sprefix|qid|sr|dib|dib_tag|th|tag|linkCode|linkId|camp|creative|creativeASIN)$/i],
];

export function cleanLink(url: string): string {
    const hashAt = url.indexOf("#");
    const hash = hashAt >= 0 ? url.slice(hashAt) : "";
    const beforeHash = hashAt >= 0 ? url.slice(0, hashAt) : url;
    const queryAt = beforeHash.indexOf("?");
    if (queryAt < 0) return url;

    const base = beforeHash.slice(0, queryAt);
    const host = base.replace(/^https?:\/\//i, "").split(/[/:]/)[0];
    const siteRule = PER_SITE.find(([site]) => site.test(host))?.[1];

    const kept = beforeHash.slice(queryAt + 1).split("&").filter(pair => {
        if (!pair) return false;
        const name = decodeURIComponentSafe(pair.split("=")[0]);
        return !ALWAYS.test(name) && !siteRule?.test(name);
    });
    return base + (kept.length ? `?${kept.join("&")}` : "") + hash;
}

function decodeURIComponentSafe(text: string) {
    try {
        return decodeURIComponent(text);
    } catch {
        return text;
    }
}

let undo: (() => void) | undefined;

export default defineCorePlugin({
    manifest: {
        id: "deltacord.cleanlinks",
        name: "Clean Links",
        version: "1.0.0",
        description: "Removes tracking junk (utm_source, fbclid, si=…) from links you send.",
        authors: [{ name: "Deltacord" }],
    },
    start() {
        undo = onSend(message => {
            message.content = outsideCode(message.content, text => rewriteLinks(text, cleanLink));
        });
    },
    stop() {
        undo?.();
        undo = undefined;
    },
} as any);
