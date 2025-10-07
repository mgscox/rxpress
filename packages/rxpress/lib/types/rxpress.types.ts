import * as bodyParser from "body-parser";
import { MetricsConfig } from "./metrics.types";

export type RxpressConfig = {
    port?: number;
    json?: bodyParser.OptionsJson;
    processHandlers: boolean;
    metrics?: MetricsConfig;
}