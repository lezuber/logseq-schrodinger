import "@logseq/libs";

import { saveAs } from "file-saver";
import JSZip, { file } from "jszip";
import { title } from "process";
import React from "react";
import ReactDOM from "react-dom";

import {
  BlockEntity,
  PageEntity,
  SettingSchemaDesc,
} from "@logseq/libs/dist/LSPlugin";

import App from "./App";
import { handleClosePopup } from "./handleClosePopup";
import { linkFormats, path } from "./index";

export var blocks2 = [];
var errorTracker = [];
var zip = new JSZip();
var imageTracker = [];
let allPublicPages;
let allPublicLinks = []; //list of all exported pages

export async function getAllPublicPages() {
  console.log("Let's go!!");
  //needs to be both public, and a page (with a name)
  const query =
    "[:find (pull ?p [*]) :where [?p :block/properties ?pr] [(get ?pr :public) ?t] [(= true ?t)][?p :block/name ?n]]";
  allPublicPages = await logseq.DB.datascriptQuery(query);
  allPublicPages = allPublicPages?.flat(); //FIXME is this needed?

  for (const x of allPublicPages) {
    allPublicLinks.push(x["original-name"].toLowerCase());
  }

  for (const x in allPublicPages) {
    const lastElement = x == `${allPublicPages.length - 1}`;
    await getBlocksInPage(allPublicPages[x], lastElement);
  }
}

function hugoDate(timestamp) {
  let date = new Date(timestamp);

  //if date.getdate does not have a zero, add A ZERO BEFORE IT
  let month;
  if (date.getMonth() + 1 < 10) {
    month = `0${date.getMonth() + 1}`;
  } else {
    month = `${date.getMonth() + 1}`;
  }
  let day;
  if (date.getDate() < 10) {
    day = `0${date.getDate()}`;
  } else {
    day = `${date.getDate()}`;
  }

  return `${date.getFullYear()}-${month}-${day}`;
}

//parse files meta-data
async function parseMeta(currPage) {
  let propList = { categories: [], tags: [], date: "", title: "" };

  propList.title = currPage["original-name"];

  if (currPage.properties.tags) propList.tags.push(...currPage.properties.tags);

  if (currPage.properties.type) {
    propList.tags = [
      ...new Set([...currPage.properties.type, ...propList.tags]),
    ];
  }

  if (currPage.properties.categories)
    propList.categories.push(...currPage.properties.categories);

  //Date - if not defined, convert Logseq timestamp
  propList.date = currPage.properties.date
    ? currPage.properties.date
    : hugoDate(currPage["created-at"]);

  propList.lastMod = currPage.properties.lastmod
    ? currPage.properties.lastmod
    : hugoDate(currPage["updated-at"]);

  //these properties should not be exported to Hugo
  const nope = ["filters", "public"];
  for (const nono of nope) {
    delete propList[nono];
  }

  //convert propList to Hugo yaml
  // https://gohugo.io/content-management/front-matter/
  let ret = `---`;
  for (let [prop, value] of Object.entries(propList)) {
    if (Array.isArray(value)) {
      ret += `\n${prop}:`;
      value.forEach((element) => (ret += `\n- ${element}`));
    } else {
      ret += `\n${prop}: ${value}`;
    }
  }
  ret += "\n---";
  return ret;
}

function removeNonAlphaNumeric(str) {
  // stripps all non-alphanumeric characters except spaces, scores and underscrores
  let stripped = str.replace(/[^a-zA-Z0-9 _-]/g, "");
  // now stripp all surrounding spaces, for note names like "🎉 Sucess with Icon" not having a score in the beginning
  stripped = stripped.trim();
  // now remove all spaces
  stripped = stripped.replace(/\s/g, "-");
  return stripped;
}

export async function getBlocksInPage(currPage, isLast) {
  //if e.page.originalName is undefined, set page to equal e.page.original-name
  if (currPage.originalName != undefined) {
    currPage["original-name"] = currPage.originalName;
  }

  const docTree = await logseq.Editor.getPageBlocksTree(
    currPage["original-name"]
  );

  const metaData = await parseMeta(currPage, [], [], [], []);
  // parse page-content

  let finalString = await parsePage(metaData, docTree);

  // console.log(`e["original-name"]: ${e["original-name"]}`);
  //page looks better in the URL
  // the following regex removes all non-alphanumeric characters
  zip.file(
    `pages/${removeNonAlphaNumeric(currPage["original-name"])}.md`,
    finalString
  );

  if (isLast) {
    setTimeout(() => {
      console.log(zip);
      zip.generateAsync({ type: "blob" }).then(function (content) {
        // see FileSaver.js
        saveAs(content, "publicExport.zip");
        //wait one second
        // setTimeout(() => {
        //   saveAs(content, "publicExport.zip");
        // }, 1000);
        zip = new JSZip();
      });
    }, imageTracker.length * 102);
  }
}

async function parsePage(finalString: string, docTree) {
  // console.log("DB parsePage")
  for (const x in docTree) {
    // skip meta-data
    if (!(parseInt(x) === 0 && docTree[x].level === 1)) {
      //parseText will return 'undefined' if a block skipped
      const ret = await parseText(docTree[x]);
      if (typeof ret != "undefined") {
        finalString = `${finalString}\n${ret}`;
      }

      if (docTree[x].children.length > 0)
        finalString = await parsePage(finalString, docTree[x].children);
    }
  }
  return finalString;
}

function parseLinks_old(text: string, allPublicPages) {
  //returns text withh all links converted

  // FIXME This needs to be rewritten (later) so we don't loop all the pages twice
  // conversion of links to hugo syntax https://gohugo.io/content-management/cross-references/
  // Two kinds of links: [[a link]]
  //                     [A description]([[a link]])
  // Regular links are done by Hugo [logseq](https://logseq.com)
  const reLink: RegExp = /\[\[.*?\]\]/g;
  const reDescrLink: RegExp = /\[([a-zA-Z ]*?)\]\(\[\[(.*?)\]\]\)/g;
  //[garden]([[digital garden]])
  if (logseq.settings.linkFormat == "Hugo Format") {
    if (reDescrLink.test(text)) {
      text = text.replaceAll(reDescrLink, (result) => {
        for (const x in allPublicPages) {
          if (
            result[2].toLowerCase ==
            allPublicPages[x]["original-name"].toLowerCase
          ) {
            const txt = reDescrLink.exec(result);
            return txt ? `[${txt[1]}]({{< ref "${txt[2]}" >}})` : "";
            // return (txt) ? `[${txt[1]}]({{< ref "${txt[2].replaceAll(" ","_")}" >}})` : ""
          }
        }
      });
    }
    text = text.replaceAll(reLink, (match) => {
      const txt = match.substring(2, match.length - 2);
      for (const x in allPublicPages) {
        if (
          txt.toUpperCase() == allPublicPages[x]["original-name"].toUpperCase()
        ) {
          return `[${txt}]({{< ref "${allPublicPages[x][
            "original-name"
          ].replaceAll(" ", " ")}" >}})`;
        }
      }
      return txt;
    });
  }
  if (logseq.settings.linkFormat == "Without brackets") {
    text = text.replaceAll("[[", "");
    text = text.replaceAll("]]", "");
  }
  return text;
}

function parseLinks(text: string, allPublicPages) {
  //returns text with all links converted

  // conversion of links to hugo syntax https://gohugo.io/content-management/cross-references/
  // Two kinds of links: [[a link]]
  //                     [A description]([[a link]])
  // Regular links are done by Hugo [logseq](https://logseq.com)
  const reLink: RegExp = /\[\[(.*?)\]\]/gim;
  const reDescrLink: RegExp = /\[([a-zA-Z ]*?)\]\(\[\[(.*?)\]\]\)/gim;

  // FIXME why doesn't this work?
  // if (! reDescrLink.test(text) && ! reLink.test(text)) return text

  let result;
  while ((result = reDescrLink.exec(text) || reLink.exec(text))) {
    if (allPublicLinks.includes(result[result.length - 1].toLowerCase())) {
      text = text.replace(
        result[0],
        `[${result[1]}]({{< ref "/pages/${removeNonAlphaNumeric(
          result[result.length - 1]
        )}" >}})`
      );
    }
  }
  if (logseq.settings.linkFormat == "Without brackets") {
    text = text.replaceAll("[[", "");
    text = text.replaceAll("]]", "");
  }
  return text;
}

async function parseNamespaces(text: string, blockLevel: number) {
  const namespace: RegExp = /{{namespace\s([^}]+)}}/gim;

  let result;
  while ((result = namespace.exec(text))) {
    const currentNamespaceName = result[result.length - 1];

    const query = `[:find (pull ?c [*]) :where [?p :block/name "${currentNamespaceName.toLowerCase()}"] [?c :block/namespace ?p]]`;
    let namespacePages = await logseq.DB.datascriptQuery(query);
    namespacePages = namespacePages?.flat(); //FIXME is this needed?

    let txtBeforeNamespacePage: string = "";
    if (logseq.settings.bulletHandling == "Convert Bullets") {
      txtBeforeNamespacePage = " ".repeat(blockLevel * 2) + "+ ";
    }

    let namespaceContent = `**Namespace [[${currentNamespaceName}]]**\n\n`;
    if (allPublicLinks.includes(currentNamespaceName.toLowerCase())) {
      namespaceContent = namespaceContent.replace(
        `[[${currentNamespaceName}]]`,
        `[${currentNamespaceName}]({{< ref "/pages/${currentNamespaceName}" >}})`
      );
    }

    for (const page of namespacePages) {
      const pageOrigName = page["original-name"];
      if (allPublicLinks.includes(page["original-name"].toLowerCase())) {
        const pageName = pageOrigName.replace(`${currentNamespaceName}/`, "");
        namespaceContent = namespaceContent.concat(
          txtBeforeNamespacePage +
            `[${pageName}]({{< ref "/pages/${pageOrigName}" >}})\n\n`
        );
      }
    }

    text = text.replace(result[0], namespaceContent);
  }

  return text;
}

async function parseText(block: BlockEntity) {
  //returns either a hugo block or `undefined`
  let re: RegExp;
  let text = block.content;

  // console.log("block", block)
  let txtBefore: string = "";
  let txtAfter: string = "\n";
  const prevBlock: BlockEntity = await logseq.Editor.getBlock(block.left.id, {
    includeChildren: false,
  });

  //Block refs - needs to be at the beginning so the block gets parsed
  //FIXME they need some indicator that it *was* an embed
  const rxGetId =
    /\(\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)\)/;
  const rxGetEd =
    /{{embed \(\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)\)}}/;
  const blockId = rxGetEd.exec(text) || rxGetId.exec(text);
  if (blockId != null) {
    const block = await logseq.Editor.getBlock(blockId[1], {
      includeChildren: true,
    });

    if (block != null) {
      // console.log("DB blockId", blockId)
      text = text.replace(
        blockId[0],
        block.content.substring(0, block.content.indexOf("id::"))
      );
    }
  }

  //task markers - skip
  if (block.marker && !logseq.settings.exportTasks) return;

  //Images
  //FIXME ![image.png](../assets/image_1650196318593_0.png){:class medium, :height 506, :width 321}
  //Logseq has extra info: height and width that can be used in an image template
  //Get regex to check if text contains a md image
  const reImage = /!\[.*?\]\((.*?)\)/g;
  try {
    text.match(reImage).forEach((element) => {
      element.match(/(?<=!\[.*\])(.*)/g).forEach((match) => {
        let finalLink = match.substring(1, match.length - 1);
        // return (match.substring(1, match.length - 1))
        text = text.replace(match, match.toLowerCase());
        if (!finalLink.includes(".pdf")) {
          text = text.replace("../", "/");
          imageTracker.push(finalLink);
          addImageToZip(finalLink);
        }
      });
    });
  } catch (error) {}

  // FIXME for now all indention is stripped out
  // Add indention — level zero is stripped of "-", rest are lists
  // Experiment, no more lists, unless + or numbers
  // (unless they're not)
  if (logseq.settings.bulletHandling == "Convert Bullets") {
    if (block.level > 1) {
      txtBefore = " ".repeat((block.level - 1) * 2) + "+ ";
      // txtBefore = "\n" + txtBefore
      if (prevBlock.level === block.level) txtAfter = "";
    }
  }
  if (prevBlock.level === block.level) txtAfter = "";
  //exceptions (logseq has "-" before every block, Hugo doesn't)
  if (text.substring(0, 3) === "```") txtBefore = "";
  // Don't - indent images
  if (reImage.test(text)) txtBefore = "";
  //indent text + add newline after block
  text = txtBefore + text + txtAfter;

  //internal links
  text = parseLinks(text, allPublicPages);

  //namespaces
  text = await parseNamespaces(text, block.level);

  //youtube embed
  //Change {{youtube url}} via regex
  const reYoutube = /{{youtube(.*?)}}/g;
  text = text.replaceAll(reYoutube, (match) => {
    const youtubeRegex = /(youtu(?:.*\/v\/|.*v\=|\.be\/))([A-Za-z0-9_\-]{11})/;
    const youtubeId = youtubeRegex.exec(match);
    if (youtubeId != null) {
      return `{{< youtube ${youtubeId[2]} >}}`;
    }
  });

  //height and width syntax regex
  // {:height 239, :width 363}
  const heightWidthRegex = /{:height\s*[0-9]*,\s*:width\s*[0-9]*}/g;
  text = text.replaceAll(heightWidthRegex, "");

  //highlighted text, not supported in hugo by default!
  re = /(==(.*?)==)/gm;
  text = text.replace(re, "{{< logseq/mark >}}$2{{< / logseq/mark >}}");

  re = /#\+BEGIN_([A-Z]*)[^\n]*\n(.*)#\+END_[^\n]*/gms;
  text = text.replace(re, "{{< logseq/org$1 >}}$2{{< / logseq/org$1 >}}");
  // text = text.toLowerCase();

  text = text.replace(/:LOGBOOK:|collapsed:: true/gi, "");
  if (text.includes("CLOCK: [")) {
    text = text.substring(0, text.indexOf("CLOCK: ["));
  }

  if (text.indexOf(`\nid:: `) === -1) {
    return text;
  } else {
    return text.substring(0, text.indexOf(`\nid:: `));
  }
}

const imageUrlToBase64 = async (url) => {
  const response = await fetch(url);
  const blob = await response.blob();
  return new Promise((onSuccess, onError) => {
    try {
      const reader = new FileReader();
      reader.onload = function () {
        onSuccess(this.result);
      };
      reader.readAsDataURL(blob);
    } catch (e) {
      onError(e);
    }
  });
};

async function addImageToZip(filePath) {
  let formattedFilePath = filePath.replace("..", path);
  const dataUrl = await imageUrlToBase64(formattedFilePath);
  var idx = dataUrl.indexOf("base64,") + "base64,".length; // or = 28 if you're sure about the prefix
  var base64 = dataUrl.substring(idx);
  await zip.file(
    "assets/" +
      filePath.split("/")[filePath.split("/").length - 1].toLowerCase(),
    base64,
    { base64: true }
  );
}

//FIXME don't get it, but it works
function download(filename, text) {
  var element = document.createElement("a");
  element.setAttribute(
    "href",
    "data:text/plain;charset=utf-8," + encodeURIComponent(text)
  );
  // element.setAttribute('download', filename);
  element.setAttribute("download", filename);

  element.style.display = "none";
  document.body.appendChild(element);

  element.click();

  document.body.removeChild(element);
}
