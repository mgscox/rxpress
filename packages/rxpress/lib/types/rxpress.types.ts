import * as bodyParser from "body-parser";
import { MetricsConfig } from "./metrics.types";

export type RxpressConfig = {
    loadEnv?: boolean;                  /* default true */
    port?: number;                      /* default 3000 */
    json?: bodyParser.OptionsJson;      /* default undefined */
    processHandlers: boolean;           /* default false */
    metrics?: MetricsConfig;            /* default undefined */
}