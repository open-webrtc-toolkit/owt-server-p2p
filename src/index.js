// Copyright (C) <2020> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0

'use strict';

const messagingService = require('./messaging');

process.on('SIGINT', async function() {
  await messagingService.stop();
  process.exit();
});
messagingService.start();