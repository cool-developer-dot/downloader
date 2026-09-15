package com.vidorax.media

import expo.modules.kotlin.exception.CodedException

// Rejections with the codes documented in src/VidoraMedia.types.ts. Codes are passed explicitly instead of being
// inferred from class names, which R8 may rename.

class NotFoundException(message: String) : CodedException("ERR_NOT_FOUND", message, null)

class InvalidStateException(message: String) : CodedException("ERR_INVALID_STATE", message, null)

class InvalidRequestException(message: String) : CodedException("ERR_INVALID_REQUEST", message, null)

class PolicyBlockedException(message: String) : CodedException("ERR_POLICY_BLOCKED", message, null)

class StoragePermissionException(message: String) : CodedException("ERR_STORAGE_PERMISSION", message, null)

class RunnerStartException(message: String, cause: Throwable? = null) :
  CodedException("ERR_RUNNER_START", message, cause)

class StorageException(message: String, cause: Throwable? = null) : CodedException("ERR_STORAGE", message, cause)

class NoAppException(message: String) : CodedException("ERR_NO_APP", message, null)
