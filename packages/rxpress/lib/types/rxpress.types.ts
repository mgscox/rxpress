import * as express from 'express';
import * as bodyParser from "body-parser";

export type RxpressConfig = {
    port?: number;
    json?: bodyParser.OptionsJson
}