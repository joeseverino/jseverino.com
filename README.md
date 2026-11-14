# dist

The HTML, CSS, scripts and images [jseverino.com](https://jseverino.com) serves, one commit per deploy
that changed them. The [deploy workflow](https://github.com/joeseverino/jseverino.com/blob/main/.github/workflows/deploy.yml)
generates every commit from the build it shipped, so nothing here is edited by hand; the source
is [`main`](https://github.com/joeseverino/jseverino.com/tree/main).

Each commit's trailers name its proof:

| Trailer | Names |
|---|---|
| `Source` | The `main` commit the build came from |
| `Run` | The workflow run that deployed it and published this commit |
| `Archive-SHA256` | The digest of the attested archive this tree was unpacked from |
| `Attestation` | The archive's signed build provenance |

To verify a deploy, download its archive (`jseverino.com-<source>.tar.gz` in the run's
`release-<source>` artifact, or a release's `.tar.gz`) and check it against its attestation:

```sh
gh attestation verify <archive>.tar.gz -R joeseverino/jseverino.com
```
