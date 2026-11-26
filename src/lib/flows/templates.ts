/**
 * Starter flow templates.
 *
 * Three pre-canned flows users can clone with one click instead of
 * building from scratch. Each template is a plain JS object describing
 * the same shape `/api/flows` PUT accepts — name, trigger config,
 * entry_node_id, fallback_policy, nodes[] — keyed by a stable
 * `slug`.
 *
 * The clone path (`/api/flows` POST with `template_slug`) creates a
 * NEW flow_row + flow_nodes rows for the user. `node_key`s are kept
 * verbatim (they're stable strings, not UUIDs, so cloning never
 * needs to rewrite edge references).
 *
 * Choosing a single static module over a DB-backed gallery for v1
 * because: (a) the set is small and changes with code releases, not
 * data; (b) keeps templates portable across self-hosted instances
 * without migrations; (c) editing in source is the lowest-friction
 * way to add the next template.
 */

import type {
  CollectInputNodeConfig,
  ConditionNodeConfig,
  HandoffNodeConfig,
  KeywordTriggerConfig,
  SendButtonsNodeConfig,
  SendListNodeConfig,
  SendMessageNodeConfig,
  StartNodeConfig,
} from "./types";
import { getT } from "@/lib/i18n/translate";

export type FlowTemplateNodeType =
  | "start"
  | "send_message"
  | "send_buttons"
  | "send_list"
  | "collect_input"
  | "condition"
  | "set_tag"
  | "handoff"
  | "end";

export interface FlowTemplateNode {
  node_key: string;
  node_type: FlowTemplateNodeType;
  config:
    | StartNodeConfig
    | SendMessageNodeConfig
    | SendButtonsNodeConfig
    | SendListNodeConfig
    | CollectInputNodeConfig
    | ConditionNodeConfig
    | HandoffNodeConfig
    | Record<string, unknown>;
}

export interface FlowTemplate {
  slug: string;
  name: string;
  description: string;
  /** Used by the gallery to surface a relevant icon. lucide-react name. */
  icon: "MessageSquare" | "HelpCircle" | "UserPlus";
  trigger_type: "keyword" | "first_inbound_message" | "manual";
  trigger_config: KeywordTriggerConfig | Record<string, unknown>;
  entry_node_id: string;
  nodes: FlowTemplateNode[];
}

const t = getT("StarterFlows");

/** Comma-separated keyword list from the catalogue → trimmed array. */
function keywords(key: string): string[] {
  return t(key)
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

// ============================================================
// 1. Welcome menu — the example from the owner's brief
// ============================================================
const WELCOME_MENU: FlowTemplate = {
  slug: "welcome_menu",
  name: t("welcome_menu.name"),
  description: t("welcome_menu.description"),
  icon: "MessageSquare",
  trigger_type: "keyword",
  trigger_config: { keywords: keywords("welcome_menu.keywords"), match_type: "contains" },
  entry_node_id: "start",
  nodes: [
    {
      node_key: "start",
      node_type: "start",
      config: { next_node_key: "welcome" },
    },
    {
      node_key: "welcome",
      node_type: "send_buttons",
      config: {
        text: t("welcome_menu.text"),
        footer_text: t("welcome_menu.footer"),
        buttons: [
          {
            reply_id: "existing",
            title: t("welcome_menu.existingButton"),
            next_node_key: "existing_handoff",
          },
          {
            reply_id: "new",
            title: t("welcome_menu.newButton"),
            next_node_key: "new_handoff",
          },
        ],
      } as SendButtonsNodeConfig,
    },
    {
      node_key: "existing_handoff",
      node_type: "handoff",
      config: {
        note: t("welcome_menu.existingNote"),
      } as HandoffNodeConfig,
    },
    {
      node_key: "new_handoff",
      node_type: "handoff",
      config: {
        note: t("welcome_menu.newNote"),
      } as HandoffNodeConfig,
    },
  ],
};

// ============================================================
// 2. FAQ bot — list-message answers, fully automated
// ============================================================
const FAQ_BOT: FlowTemplate = {
  slug: "faq_bot",
  name: t("faq_bot.name"),
  description: t("faq_bot.description"),
  icon: "HelpCircle",
  trigger_type: "keyword",
  trigger_config: {
    keywords: keywords("faq_bot.keywords"),
    match_type: "contains",
  },
  entry_node_id: "start",
  nodes: [
    {
      node_key: "start",
      node_type: "start",
      config: { next_node_key: "topics" },
    },
    {
      node_key: "topics",
      node_type: "send_list",
      config: {
        text: t("faq_bot.text"),
        button_label: t("faq_bot.buttonLabel"),
        sections: [
          {
            title: t("faq_bot.commonSection"),
            rows: [
              {
                reply_id: "hours",
                title: t("faq_bot.hoursRow"),
                next_node_key: "answer_hours",
              },
              {
                reply_id: "pricing",
                title: t("faq_bot.pricingRow"),
                next_node_key: "answer_pricing",
              },
              {
                reply_id: "refunds",
                title: t("faq_bot.refundsRow"),
                next_node_key: "answer_refunds",
              },
            ],
          },
          {
            title: t("faq_bot.otherSection"),
            rows: [
              {
                reply_id: "human",
                title: t("faq_bot.humanRow"),
                next_node_key: "human_handoff",
              },
            ],
          },
        ],
      } as SendListNodeConfig,
    },
    {
      node_key: "answer_hours",
      node_type: "send_message",
      config: {
        text: t("faq_bot.hoursAnswer"),
        next_node_key: "end",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "answer_pricing",
      node_type: "send_message",
      config: {
        text: t("faq_bot.pricingAnswer"),
        next_node_key: "end",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "answer_refunds",
      node_type: "send_message",
      config: {
        text: t("faq_bot.refundsAnswer"),
        next_node_key: "end",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "human_handoff",
      node_type: "handoff",
      config: {
        note: t("faq_bot.humanNote"),
      } as HandoffNodeConfig,
    },
    {
      node_key: "end",
      node_type: "end",
      config: {},
    },
  ],
};

// ============================================================
// 3. Lead capture — collect_input chain, ends in a handoff
// ============================================================
const LEAD_CAPTURE: FlowTemplate = {
  slug: "lead_capture",
  name: t("lead_capture.name"),
  description: t("lead_capture.description"),
  icon: "UserPlus",
  trigger_type: "first_inbound_message",
  trigger_config: {},
  entry_node_id: "start",
  nodes: [
    {
      node_key: "start",
      node_type: "start",
      config: { next_node_key: "intro" },
    },
    {
      node_key: "intro",
      node_type: "send_message",
      config: {
        text: t("lead_capture.intro"),
        next_node_key: "ask_name",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "ask_name",
      node_type: "collect_input",
      config: {
        prompt_text: t("lead_capture.askName"),
        var_key: "name",
        next_node_key: "ask_email",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "ask_email",
      node_type: "collect_input",
      config: {
        prompt_text: t("lead_capture.askEmail", { name: "{{vars.name}}" }),
        var_key: "email",
        next_node_key: "ask_company",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "ask_company",
      node_type: "collect_input",
      config: {
        prompt_text: t("lead_capture.askCompany"),
        var_key: "company",
        next_node_key: "handoff",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "handoff",
      node_type: "handoff",
      config: {
        note: t("lead_capture.handoffNote", {
          name: "{{vars.name}}",
          email: "{{vars.email}}",
          company: "{{vars.company}}",
        }),
      } as HandoffNodeConfig,
    },
  ],
};

// ============================================================
// 4. Admissions welcome (M4, #67; menu: ADR 0035) — a parent's first
// message, or a scanned QR. Menu: call back, school visit, online
// meeting. Then the child's name and date of birth, then a call on the
// Today list or the right booking calendar.
// Admissions intake (src/admissions/lib/intake.ts) reads the vars:
// child_name, child_dob, menu (the tapped button's reply id: call_back
// makes the call task) and campus (reply id = the campus setting's
// tag). Keep those node keys and reply ids when editing the words in
// Flows. Booking links carry the parent's number and the child's name
// so Cal.com recognises the family (Cal.com prefills a booking question
// from the URL parameter named after it).
// ============================================================
const CAL = "https://cal.com/nimish-shah-zp0z89";
const calLink = (event: string) =>
  `${CAL}/${event}?attendeePhoneNumber=%2B{{vars.contact_phone}}&child-first-name={{vars.child_name|url}}`;
const ADMISSIONS_WELCOME: FlowTemplate = {
  slug: "admissions_welcome",
  name: t("admissions_welcome.name"),
  description: t("admissions_welcome.description"),
  icon: "UserPlus",
  trigger_type: "first_inbound_message",
  trigger_config: {},
  entry_node_id: "start",
  nodes: [
    { node_key: "start", node_type: "start", config: { next_node_key: "menu" } },
    {
      node_key: "menu",
      node_type: "send_buttons",
      config: {
        text: t("admissions_welcome.menu"),
        buttons: [
          { reply_id: "call_back", title: t("admissions_welcome.menuCallBack"), next_node_key: "ask_child" },
          { reply_id: "visit", title: t("admissions_welcome.menuVisit"), next_node_key: "ask_child" },
          { reply_id: "online", title: t("admissions_welcome.menuOnline"), next_node_key: "ask_child" },
        ],
      } as SendButtonsNodeConfig,
    },
    {
      node_key: "ask_child",
      node_type: "collect_input",
      config: {
        prompt_text: t("admissions_welcome.askChild"),
        var_key: "child_name",
        next_node_key: "ask_dob",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "ask_dob",
      node_type: "collect_input",
      config: {
        prompt_text: t("admissions_welcome.askDob", { name: "{{vars.child_name}}" }),
        var_key: "child_dob",
        next_node_key: "is_call_back",
      } as CollectInputNodeConfig,
    },
    {
      node_key: "is_call_back",
      node_type: "condition",
      config: {
        subject: "var",
        subject_key: "menu",
        operator: "equals",
        value: "call_back",
        true_next: "call_thanks",
        false_next: "is_visit",
      } as ConditionNodeConfig,
    },
    {
      node_key: "call_thanks",
      node_type: "send_message",
      config: { text: t("admissions_welcome.callThanks"), next_node_key: "handoff" } as SendMessageNodeConfig,
    },
    {
      node_key: "handoff",
      node_type: "handoff",
      config: {
        note: t("admissions_welcome.handoffNote", { name: "{{vars.child_name}}", dob: "{{vars.child_dob}}" }),
      } as HandoffNodeConfig,
    },
    {
      node_key: "is_visit",
      node_type: "condition",
      config: {
        subject: "var",
        subject_key: "menu",
        operator: "equals",
        value: "visit",
        true_next: "campus",
        false_next: "online_link",
      } as ConditionNodeConfig,
    },
    {
      node_key: "campus",
      node_type: "send_buttons",
      config: {
        text: t("admissions_welcome.askCampus"),
        buttons: [
          { reply_id: "neev", title: t("admissions_welcome.campusNeev"), next_node_key: "neev_link" },
          { reply_id: "gurukul", title: t("admissions_welcome.campusGurukul"), next_node_key: "gurukul_link" },
        ],
      } as SendButtonsNodeConfig,
    },
    {
      node_key: "neev_link",
      node_type: "send_message",
      config: {
        text: t("admissions_welcome.visitLink", { name: "{{vars.child_name}}", link: calLink("school-visit-neev") }),
        next_node_key: "done",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "gurukul_link",
      node_type: "send_message",
      config: {
        text: t("admissions_welcome.visitLink", { name: "{{vars.child_name}}", link: calLink("school-visit") }),
        next_node_key: "done",
      } as SendMessageNodeConfig,
    },
    {
      node_key: "online_link",
      node_type: "send_message",
      config: {
        text: t("admissions_welcome.onlineLink", { link: calLink("online-meeting") }),
        next_node_key: "done",
      } as SendMessageNodeConfig,
    },
    { node_key: "done", node_type: "end", config: {} },
  ],
};

// ============================================================
// Registry
// ============================================================

const TEMPLATES: Record<string, FlowTemplate> = {
  admissions_welcome: ADMISSIONS_WELCOME,
  welcome_menu: WELCOME_MENU,
  faq_bot: FAQ_BOT,
  lead_capture: LEAD_CAPTURE,
};

export function getFlowTemplate(slug: string): FlowTemplate | null {
  return TEMPLATES[slug] ?? null;
}

export function listFlowTemplates(): FlowTemplate[] {
  return Object.values(TEMPLATES);
}
