import streamDeck from "@elgato/streamdeck";
import { PHButton } from "./actions/ph-button";

streamDeck.actions.registerAction(new PHButton());
streamDeck.connect();
