// Package web embeds the built SPA. Run `npm run build` in web/ first.
package web

import "embed"

//go:embed all:dist
var Dist embed.FS
