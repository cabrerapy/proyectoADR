#!/usr/bin/env node
import { App } from "aws-cdk-lib";

import { createInfrastructure } from "../infrastructure-app.js";

const app = new App();
createInfrastructure(app);
app.synth();
