package com.vidorax.media.files

import androidx.core.content.FileProvider

/** A dedicated subclass so this provider's manifest entry never merges with another library's FileProvider. */
class VidoraFileProvider : FileProvider()
