import "@logseq/libs";
import {
  PageEntity,
  BlockEntity,
  SettingSchemaDesc,
} from "@logseq/libs/dist/LSPlugin";
import React from "react";
import ReactDOM from "react-dom";
import App from "./App";
import { handleClosePopup } from "./handleClosePopup";
import { getAllPublicPages, getBlocksInPage } from "./utils";

export var path = "";

const linkFormats = ["[[Logseq Format]]", "Without brackets"];

let settings: SettingSchemaDesc[] = [
  {
    key: "linkFormat",
    type: "enum",
    enumChoices: linkFormats,
    enumPicker: "radio",
    title: "How would you like links to be formatted",
    description:
      "Do you want your exported links with or without brackets? If a page that is linked to is public, the link will automatically be hyperlinked in the hugo export, otherwise, this setting will be applied",
    default: linkFormats[0],
  },
  {
    key: "bulletHandling",
    type: "enum",
    enumChoices: ["Convert Bullets", "Remove All Bullets"],
    enumPicker: "radio",
    title: "How would you like Logseq's bullets to be handled",
    description:
      "How would you like Logseq's bullets to be handled, convert to hugo's native style or remove all bullets?",
    default: "Convert Bullets",
  },
  {
    key: "exportTasks",
    type: "boolean",
    title: "Do you want tasks to exported to Hugo?",
    description:
      "Yes, blocks with tasks will be exported: (TODO DOING DONE LATER NOW WAITING)",
    default: false,
  },
];
const main = async () => {
  console.log("Logseq Schrödinger plugin loaded");
  ReactDOM.render(
    //Render react component
    <React.StrictMode>
      <App />
    </React.StrictMode>,
    document.getElementById("app")
  );

  logseq.setMainUIInlineStyle({
    position: "fixed",
    zIndex: 999,
    transform: "translateX(-50%)",
  });
  function createModel() {
    return {
      show(e: any) {
        const { rect } = e;

        logseq.setMainUIInlineStyle({
          top: `${rect.top + 25}px`,
          left: `${rect.right - 17}px`,
        });

        logseq.toggleMainUI();
        handleClosePopup();
      },

      export() {
        getAllPublicPages();
      },
    };
  }

  logseq.provideModel(createModel());
  logseq.setMainUIInlineStyle({
    zIndex: 11,
  });

  logseq.App.registerUIItem("toolbar", {
    key: "export-public-pages-to-hugo",
    template: `
      <a class="button" data-on-click="export" data-rect>
        <i class="ti ti-database-export"></i>
      </a>
    `,
  });

  logseq.useSettingsSchema(settings);
  path = (await logseq.App.getCurrentGraph()).path;
};

logseq.ready(main).catch(console.error);
