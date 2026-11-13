package com.vidorax.web.share

import androidx.core.content.FileProvider

/** B22 #249: shares the QR image from `<cacheDir>/qr/` only (res/xml/vidorax_web_file_paths.xml). Not exported. */
class WebFileProvider : FileProvider()
