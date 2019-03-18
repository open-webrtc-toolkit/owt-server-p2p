// Copyright (C) <2015> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0

module.exports = function() {
  // successCallback should contains a parameter uid
  var authentication = function(token, successCallback, failureCallback) {
    // TODO: Please overwrite this method for authentication.
    successCallback(token);
  };

  return {authentication:authentication};
}();
