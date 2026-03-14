# installer.nsh — Discowl Browser
# Préserve les raccourcis bureau et barre des tâches lors des mises à jour.

!macro customInstall
  # Après installation : ne rien faire de spécial
  # createDesktopShortcut "ifNotPresent" gère déjà le bureau
!macroend

!macro customUnInstall
  # Lors d'une désinstallation manuelle : supprimer normalement
  Delete "$DESKTOP\Discowl Browser.lnk"
  Delete "$SMPROGRAMS\Discowl Browser\Discowl Browser.lnk"
  RMDir "$SMPROGRAMS\Discowl Browser"
!macroend

!macro customRemoveFiles
  # Appelé lors d'une mise à jour AVANT d'écraser les fichiers.
  # On ne supprime PAS les raccourcis ici — ils seront gérés par
  # createDesktopShortcut "ifNotPresent" qui ne les recrée que s'ils manquent.
  # Ainsi un raccourci existant (même déplacé par l'utilisateur) est préservé.
!macroend
