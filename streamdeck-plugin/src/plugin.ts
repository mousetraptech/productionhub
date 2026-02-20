import streamDeck from "@elgato/streamdeck";
import { PHButton } from "./actions/ph-button";
import { setHubLogger } from "./lib/hub-client";

// Route hub-client logs through the SDK logger (writes to plugin logs dir)
const hubLogger = streamDeck.logger.createScope("Hub");
setHubLogger((msg) => hubLogger.info(msg));

streamDeck.actions.registerAction(new PHButton());
streamDeck.connect();
